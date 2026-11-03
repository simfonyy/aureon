//! Bounded, in-memory audio inputs for matching a song to its music video.
//! Signed CDN URLs never receive OAuth headers and are never persisted here.

use std::{
    collections::{HashMap, HashSet},
    io::Cursor,
    time::{Duration, Instant},
};

use crate::yandex::Yandex;
use reqwest::{Client, Url};

const RATE: u32 = 4000;
const SECONDS: usize = 300;
const TRACK_BYTES: usize = 16 * 1024 * 1024;
const CLIP_BYTES: usize = 48 * 1024 * 1024;
const SEGMENT_BYTES: usize = 4 * 1024 * 1024;
const AUDIO_BYTES: usize = 12 * 1024 * 1024;
const PLAYLIST_BYTES: usize = 256 * 1024;
const MAX_SEGMENTS: usize = 200;
const DEADLINE: Duration = Duration::from_secs(90);
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

fn media_url(raw: &str, base: Option<&Url>) -> Result<Url, String> {
    if raw.is_empty() || raw.len() > 8192 || raw.chars().any(char::is_control) || raw.contains('\\')
    {
        return Err("Неподдерживаемый адрес звука клипа".into());
    }
    let url = match base {
        Some(base) => base.join(raw),
        None => Url::parse(raw),
    }
    .map_err(|_| "Неподдерживаемый адрес звука клипа")?;
    let host = url.host_str().ok_or("В адресе звука нет сервера")?;
    let allowed = ["yandex.net", "yandex.ru", "yandex.com", "yandexcdn.net"]
        .iter()
        .any(|domain| host == *domain || host.ends_with(&format!(".{domain}")));
    if !allowed
        || url.scheme() != "https"
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("Неподдерживаемый адрес звука клипа".into());
    }
    Ok(url)
}

async fn bytes_at(http: &Client, mut url: Url, limit: usize) -> Result<(Vec<u8>, Url), String> {
    // Signed audio API URLs may redirect to a CDN. Validate every hop, with no
    // automatic redirect policy, cookies, authorization, or unbounded bodies.
    for hop in 0..=3 {
        let mut response = http
            .get(url.clone())
            .send()
            .await
            .map_err(|_| "Не удалось загрузить звук для синхронизации")?;
        if response.status().is_redirection() {
            if hop == 3 {
                return Err("Слишком много перенаправлений звука".into());
            }
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or("Нет адреса перенаправления звука")?;
            url = media_url(location, Some(&url))?;
            continue;
        }
        if !response.status().is_success() {
            return Err("Звук для синхронизации недоступен".into());
        }
        if response
            .content_length()
            .is_some_and(|length| length > limit as u64)
        {
            return Err("Звук для синхронизации слишком большой".into());
        }
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Загрузка звука прервана")?
        {
            if body.len().saturating_add(chunk.len()) > limit {
                return Err("Звук для синхронизации слишком большой".into());
            }
            body.extend_from_slice(&chunk);
        }
        return Ok((body, url));
    }
    Err("Не удалось загрузить звук".into())
}

fn attributes(raw: &str) -> Result<HashMap<String, String>, String> {
    if raw.len() > 8192 {
        return Err("Слишком длинная строка плейлиста клипа".into());
    }
    let mut result = HashMap::new();
    let mut quoted = false;
    let mut start = 0;
    for (index, byte) in raw
        .bytes()
        .enumerate()
        .chain(std::iter::once((raw.len(), b',')))
    {
        if byte == b'"' {
            quoted = !quoted;
        }
        if byte == b',' && !quoted {
            let item = raw[start..index].trim();
            if !item.is_empty() {
                let (key, value) = item
                    .split_once('=')
                    .ok_or("Неверные параметры плейлиста клипа")?;
                if result.len() >= 32
                    || result
                        .insert(
                            key.trim().to_owned(),
                            value.trim().trim_matches('"').to_owned(),
                        )
                        .is_some()
                {
                    return Err("Повторяющиеся параметры плейлиста клипа".into());
                }
            }
            start = index + 1;
        }
    }
    if quoted {
        return Err("Незакрытые параметры плейлиста клипа".into());
    }
    Ok(result)
}

#[derive(Debug)]
struct Segment {
    url: Url,
    start: f64,
}
#[derive(Debug)]
enum Playlist {
    Next(Url),
    Segments(Vec<Segment>),
}

fn playlist(body: &[u8], base: &Url) -> Result<Playlist, String> {
    if body.len() > PLAYLIST_BYTES {
        return Err("Плейлист клипа слишком большой".into());
    }
    let text = std::str::from_utf8(body).map_err(|_| "Не удалось прочитать плейлист клипа")?;
    let text = text.trim_start_matches('\u{feff}');
    if !text
        .lines()
        .next()
        .is_some_and(|line| line.trim() == "#EXTM3U")
        || text.contains('\0')
    {
        return Err("Неподдерживаемый плейлист клипа".into());
    }
    let mut variants: Vec<(u64, bool, Url, String)> = Vec::new();
    let mut alternate = Vec::new();
    let mut pending_variant: Option<HashMap<String, String>> = None;
    let mut pending_duration = None;
    let mut segments = Vec::new();
    let mut elapsed = 0.0;
    let mut end_list = false;
    for (line_number, line) in text.lines().enumerate() {
        if line_number > 8192 || line.len() > 8192 {
            return Err("Плейлист клипа слишком большой".into());
        }
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(raw) = line
            .strip_prefix("#EXT-X-KEY:")
            .or_else(|| line.strip_prefix("#EXT-X-SESSION-KEY:"))
        {
            if attributes(raw)?.get("METHOD").map(String::as_str) != Some("NONE") {
                return Err("Зашифрованный клип нельзя автоматически синхронизировать".into());
            }
        } else if line.starts_with("#EXT-X-DISCONTINUITY")
            || line.starts_with("#EXT-X-BYTERANGE")
            || line.starts_with("#EXT-X-MAP:")
            || line == "#EXT-X-GAP"
        {
            return Err("Монтаж этого потока пока нельзя автоматически синхронизировать".into());
        } else if let Some(raw) = line.strip_prefix("#EXT-X-MEDIA:") {
            let attrs = attributes(raw)?;
            if attrs.get("TYPE").map(String::as_str) == Some("AUDIO") {
                if let (Some(group), Some(uri)) = (attrs.get("GROUP-ID"), attrs.get("URI")) {
                    if alternate.len() >= 32 {
                        return Err("Слишком много звуковых дорожек клипа".into());
                    }
                    alternate.push((group.clone(), media_url(uri, Some(base))?));
                }
            }
        } else if let Some(raw) = line.strip_prefix("#EXT-X-STREAM-INF:") {
            if pending_variant.is_some() {
                return Err("Неполный вариант плейлиста клипа".into());
            }
            pending_variant = Some(attributes(raw)?);
        } else if let Some(raw) = line.strip_prefix("#EXTINF:") {
            let duration = raw
                .split(',')
                .next()
                .unwrap_or("")
                .parse::<f64>()
                .map_err(|_| "Неверная длительность фрагмента клипа")?;
            if !duration.is_finite()
                || duration <= 0.0
                || duration > 30.0
                || pending_duration.is_some()
            {
                return Err("Неподдерживаемая длительность фрагмента клипа".into());
            }
            pending_duration = Some(duration);
        } else if line == "#EXT-X-ENDLIST" {
            end_list = true;
        } else if !line.starts_with('#') {
            let url = media_url(line, Some(base))?;
            if let Some(attrs) = pending_variant.take() {
                if variants.len() >= 128 {
                    return Err("Слишком много вариантов клипа".into());
                }
                let bandwidth = attrs
                    .get("BANDWIDTH")
                    .and_then(|value| value.parse::<u64>().ok())
                    .filter(|value| *value > 0)
                    .ok_or("Неизвестный битрейт клипа")?;
                let codecs = attrs
                    .get("CODECS")
                    .map(|value| value.to_ascii_lowercase())
                    .unwrap_or_default();
                // A declared compatible AAC track is preferred. Unknown codecs
                // can still be inspected by the bounded TS/ADTS decoder below.
                let audio_only = !codecs.is_empty()
                    && codecs
                        .split(',')
                        .all(|value| value.trim().starts_with("mp4a.40.2"));
                variants.push((
                    bandwidth,
                    audio_only,
                    url,
                    attrs.get("AUDIO").cloned().unwrap_or_default(),
                ));
            } else {
                let duration = pending_duration
                    .take()
                    .ok_or("У фрагмента клипа нет длительности")?;
                if elapsed < SECONDS as f64 {
                    if segments.len() >= MAX_SEGMENTS {
                        return Err("Слишком много фрагментов для синхронизации".into());
                    }
                    segments.push(Segment {
                        url,
                        start: elapsed,
                    });
                }
                elapsed += duration;
            }
        }
    }
    if pending_duration.is_some() || pending_variant.is_some() {
        return Err("Неполный плейлист клипа".into());
    }
    if !variants.is_empty() {
        if !segments.is_empty() {
            return Err("Смешанные варианты плейлиста клипа".into());
        }
        variants.sort_by_key(|(bandwidth, audio_only, _, _)| (!*audio_only, *bandwidth));
        let (_, audio_only, url, group) = variants.remove(0);
        if !audio_only {
            if let Some((_, audio)) = alternate.into_iter().find(|(id, _)| *id == group) {
                return Ok(Playlist::Next(audio));
            }
        }
        return Ok(Playlist::Next(url));
    }
    if segments.is_empty() || !end_list {
        return Err("Для синхронизации нужен полный клип".into());
    }
    Ok(Playlist::Segments(segments))
}

fn timestamp(bytes: &[u8]) -> Option<u64> {
    if bytes.len() < 5 || bytes[0] & 1 == 0 || bytes[2] & 1 == 0 || bytes[4] & 1 == 0 {
        return None;
    }
    Some(
        ((bytes[0] as u64 & 14) << 29)
            | ((bytes[1] as u64) << 22)
            | ((bytes[2] as u64 & 254) << 14)
            | ((bytes[3] as u64) << 7)
            | ((bytes[4] as u64) >> 1),
    )
}

fn pts_delta(value: u64, origin: u64) -> i64 {
    const WRAP: i64 = 1i64 << 33;
    let difference = value as i64 - origin as i64;
    if difference > WRAP / 2 {
        difference - WRAP
    } else if difference < -WRAP / 2 {
        difference + WRAP
    } else {
        difference
    }
}

#[derive(Default)]
struct Pes {
    header: Vec<u8>,
    complete: bool,
    remaining: Option<usize>,
}

#[derive(Default)]
struct TsAudio {
    audio_pid: Option<u16>,
    pending: HashMap<u16, Pes>,
    audio: Vec<u8>,
    first_audio_pts: Option<u64>,
    first_timestamps: HashMap<u16, u64>,
    last_counter: Option<(u8, Vec<u8>)>,
}

impl TsAudio {
    fn push_segment(&mut self, data: &[u8], start: f64) -> Result<(), String> {
        if data.is_empty() || data.len() % 188 != 0 {
            return Err("Неизвестный контейнер звука клипа".into());
        }
        self.last_counter = None;
        let mut segment_pts = None;
        let previous_audio = self.audio.len();
        for packet in data.chunks_exact(188) {
            if packet[0] != 0x47 {
                return Err("Повреждённый фрагмент клипа".into());
            }
            let pid = ((packet[1] as u16 & 31) << 8) | packet[2] as u16;
            let control = packet[3] >> 4 & 3;
            if control == 0 {
                return Err("Повреждённый пакет клипа".into());
            }
            let mut offset = 4;
            if control & 2 != 0 {
                offset += 1 + packet[4] as usize;
                if offset > 188 {
                    return Err("Повреждённая адаптация пакета клипа".into());
                }
            }
            if control & 1 == 0 || offset == 188 {
                continue;
            }
            let payload = &packet[offset..];
            let begins = packet[1] & 0x40 != 0;
            if self.audio_pid == Some(pid) {
                if packet[1] & 0x80 != 0 || packet[3] & 0xc0 != 0 {
                    return Err("Звук клипа повреждён или зашифрован".into());
                }
                let cc = packet[3] & 15;
                if let Some((previous, bytes)) = &self.last_counter {
                    if cc == *previous && payload == bytes {
                        continue;
                    }
                    if cc != (*previous + 1) % 16 {
                        return Err("Во фрагменте клипа пропущены пакеты звука".into());
                    }
                }
                self.last_counter = Some((cc, payload.to_vec()));
            }
            let mut state = if begins {
                // The PES prefix itself may cross packets with a long
                // adaptation field. Hold at most eight candidate PID headers.
                let prefix_len = payload.len().min(3);
                if payload[..prefix_len] != [0, 0, 1][..prefix_len] {
                    self.pending.remove(&pid);
                    continue;
                }
                if self.pending.len() >= 8 && !self.pending.contains_key(&pid) {
                    return Err("Слишком много дорожек клипа".into());
                }
                Pes::default()
            } else {
                match self.pending.remove(&pid) {
                    Some(state) => state,
                    None => continue,
                }
            };
            let mut cursor = 0;
            if !state.complete {
                while cursor < payload.len()
                    && (state.header.len() < 9 || state.header.len() < 9 + state.header[8] as usize)
                {
                    state.header.push(payload[cursor]);
                    cursor += 1;
                    if state.header.len() == 4
                        && !(0xc0..=0xdf).contains(&state.header[3])
                        && !(0xe0..=0xef).contains(&state.header[3])
                    {
                        break;
                    }
                }
                if state.header.len() >= 4
                    && !(0xc0..=0xdf).contains(&state.header[3])
                    && !(0xe0..=0xef).contains(&state.header[3])
                {
                    continue;
                }
                if state.header.len() < 9 || state.header.len() < 9 + state.header[8] as usize {
                    self.pending.insert(pid, state);
                    continue;
                }
                if !state.header.starts_with(&[0, 0, 1]) || state.header[6] & 0xc0 != 0x80 {
                    return Err("Неподдерживаемый заголовок звука клипа".into());
                }
                let audio = (0xc0..=0xdf).contains(&state.header[3]);
                let flags = state.header[7] >> 6;
                let pts = if flags & 2 != 0 {
                    timestamp(&state.header[9..])
                } else {
                    None
                };
                let dts = if flags == 3 {
                    timestamp(state.header.get(14..).unwrap_or_default())
                } else {
                    pts
                };
                if start == 0.0 {
                    if let Some(time) = dts {
                        if self.first_timestamps.len() >= 8
                            && !self.first_timestamps.contains_key(&pid)
                        {
                            return Err("Слишком много временных шкал клипа".into());
                        }
                        self.first_timestamps.entry(pid).or_insert(time);
                    }
                }
                if !audio {
                    continue;
                }
                match self.audio_pid {
                    Some(selected) if selected != pid => continue,
                    None => self.audio_pid = Some(pid),
                    _ => {}
                }
                if self.last_counter.is_none() {
                    self.last_counter = Some((packet[3] & 15, payload.to_vec()));
                }
                let pts = pts.ok_or("У звуковой дорожки клипа нет временных меток")?;
                self.first_audio_pts.get_or_insert(pts);
                segment_pts.get_or_insert(pts);
                let length = u16::from_be_bytes([state.header[4], state.header[5]]) as usize;
                state.remaining = if length == 0 {
                    None
                } else {
                    Some(
                        length
                            .checked_sub(3 + state.header[8] as usize)
                            .ok_or("Неверная длина пакета звука")?,
                    )
                };
                state.complete = true;
            }
            if self.audio_pid == Some(pid) {
                let available = payload.len() - cursor;
                let count = state
                    .remaining
                    .map_or(available, |remaining| remaining.min(available));
                if self.audio.len().saturating_add(count) > AUDIO_BYTES {
                    return Err("Звуковая дорожка клипа слишком большая".into());
                }
                self.audio
                    .extend_from_slice(&payload[cursor..cursor + count]);
                if let Some(remaining) = &mut state.remaining {
                    *remaining -= count;
                }
                self.pending.insert(pid, state);
            }
        }
        if let (Some(first), Some(pts)) = (self.first_audio_pts, segment_pts) {
            // Do not return falsely continuous samples when an unannounced
            // timestamp reset or an omitted section changes the media clock.
            if (pts_delta(pts, first) as f64 / 90_000.0 - start).abs() > 0.5 {
                return Err("Временная шкала клипа меняется внутри потока".into());
            }
        }
        if self.audio.len() == previous_audio {
            return Err("Во фрагменте клипа нет звуковой дорожки".into());
        }
        Ok(())
    }

    fn finish(self) -> Result<(Vec<u8>, f64), String> {
        if self.audio.is_empty() {
            return Err("В клипе нет поддерживаемой дорожки AAC".into());
        }
        validate_adts(&self.audio)?;
        let first = self
            .first_audio_pts
            .ok_or("У клипа нет временных меток звука")?;
        let origin = self
            .first_timestamps
            .values()
            .map(|value| pts_delta(*value, first))
            .min()
            .unwrap_or(0)
            .min(0);
        let lead = -origin as f64 / 90_000.0;
        if lead > 30.0 {
            return Err("Начало звука клипа нельзя определить".into());
        }
        Ok((self.audio, lead))
    }
}

fn adts_info(bytes: &[u8]) -> Result<(usize, u32), String> {
    const RATES: [u32; 13] = [
        96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
    ];
    let mut cursor = 0;
    let mut parameters = None;
    let mut frames = 0;
    while cursor < bytes.len() {
        let header = bytes
            .get(cursor..cursor + 7)
            .ok_or("Неполный кадр звука клипа")?;
        if header[0] != 0xff || header[1] != 0xf1 || header[2] >> 6 != 1 || header[6] & 3 != 0 {
            return Err("Формат AAC клипа пока нельзя синхронизировать".into());
        }
        let current = (
            header[2] >> 2 & 15,
            ((header[2] & 1) << 2) | (header[3] >> 6),
        );
        if current.0 >= 13
            || current.1 == 0
            || current.1 > 2
            || parameters.is_some_and(|previous| previous != current)
        {
            return Err("Параметры AAC меняются внутри клипа".into());
        }
        parameters = Some(current);
        let length = ((header[3] as usize & 3) << 11)
            | ((header[4] as usize) << 3)
            | (header[5] as usize >> 5);
        if length < 7 || cursor.saturating_add(length) > bytes.len() {
            return Err("Неполный кадр звука клипа".into());
        }
        cursor += length;
        frames += 1;
    }
    let (rate, _) = parameters.ok_or("В клипе нет кадров AAC")?;
    Ok((frames * 1024, RATES[rate as usize]))
}

fn validate_adts(bytes: &[u8]) -> Result<(), String> {
    adts_info(bytes).map(|_| ())
}

fn decode_mono(
    bytes: Vec<u8>,
    extension: &str,
    lead: f64,
    deadline: Instant,
) -> Result<Vec<f32>, String> {
    use rubato::Resampler;
    use symphonia::core::{
        audio::SampleBuffer, codecs::DecoderOptions, errors::Error, formats::FormatOptions,
        io::MediaSourceStream, meta::MetadataOptions, probe::Hint,
    };
    let stream = MediaSourceStream::new(Box::new(Cursor::new(bytes)), Default::default());
    let mut hint = Hint::new();
    hint.with_extension(extension);
    let options = FormatOptions {
        enable_gapless: true,
        ..Default::default()
    };
    let mut format = symphonia::default::get_probe()
        .format(&hint, stream, &options, &MetadataOptions::default())
        .map_err(|_| "Не удалось прочитать звук для синхронизации")?
        .format;
    let track = format.default_track().ok_or("В записи нет звука")?;
    let track_id = track.id;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|_| "Этот кодек нельзя автоматически синхронизировать")?;
    let limit = RATE as usize * SECONDS;
    let padding = (lead * RATE as f64).round() as usize;
    let mut samples = vec![0.0; padding.min(limit)];
    let mut resampler: Option<rubato::SincFixedIn<f32>> = None;
    let mut pending = Vec::with_capacity(4096);
    let mut source_rate = 0;
    let mut frames = 0usize;
    let mut delay = 0;
    let started = Instant::now();
    fn append(output: Vec<Vec<f32>>, target: &mut Vec<f32>, delay: &mut usize) {
        if let Some(channel) = output.first() {
            let skipped = (*delay).min(channel.len());
            *delay -= skipped;
            let count = (RATE as usize * SECONDS).saturating_sub(target.len());
            target.extend(channel.iter().skip(skipped).take(count).map(|value| {
                if value.is_finite() {
                    value.clamp(-1.0, 1.0)
                } else {
                    0.0
                }
            }));
        }
    }
    while samples.len() < limit {
        if started.elapsed() > Duration::from_secs(25) || Instant::now() >= deadline {
            return Err("Декодирование звука заняло слишком много времени".into());
        }
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(Error::IoError(error)) if error.kind() == std::io::ErrorKind::UnexpectedEof => {
                break
            }
            Err(_) => return Err("Не удалось прочитать звук для синхронизации".into()),
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            // Missing audio samples would change the clock: reject the input
            // rather than silently stitching damaged frames together.
            Err(Error::DecodeError(_)) => {
                return Err("Повреждённый звук нельзя синхронизировать".into())
            }
            Err(_) => return Err("Не удалось декодировать звук для синхронизации".into()),
        };
        let spec = *decoded.spec();
        let channels = spec.channels.count();
        if spec.rate < RATE
            || spec.rate > 192_000
            || channels == 0
            || channels > 8
            || decoded.capacity() > 262_144
        {
            return Err("Неподдерживаемые параметры звука для синхронизации".into());
        }
        if resampler.is_none() {
            source_rate = spec.rate;
            let next = rubato::SincFixedIn::new(
                RATE as f64 / spec.rate as f64,
                1.0,
                rubato::SincInterpolationParameters {
                    sinc_len: 64,
                    f_cutoff: 0.92,
                    oversampling_factor: 128,
                    interpolation: rubato::SincInterpolationType::Linear,
                    window: rubato::WindowFunction::Blackman2,
                },
                4096,
                1,
            )
            .map_err(|_| "Не удалось подготовить звук для синхронизации")?;
            delay = next.output_delay();
            resampler = Some(next);
        } else if source_rate != spec.rate {
            return Err("Частота звука меняется внутри записи".into());
        }
        let mut buffer = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
        buffer.copy_interleaved_ref(decoded);
        for frame in buffer.samples().chunks_exact(channels) {
            let mono = frame
                .iter()
                .copied()
                .filter(|value| value.is_finite())
                .sum::<f32>()
                / channels as f32;
            pending.push(mono.clamp(-1.0, 1.0));
            frames += 1;
            if pending.len() == 4096 {
                let output = resampler
                    .as_mut()
                    .unwrap()
                    .process(&[pending.as_slice()], None)
                    .map_err(|_| "Не удалось преобразовать звук для синхронизации")?;
                append(output, &mut samples, &mut delay);
                pending.clear();
            }
            if samples.len() >= limit {
                break;
            }
        }
    }
    if samples.len() < limit {
        if let Some(resampler) = resampler.as_mut() {
            let output = if pending.is_empty() {
                resampler.process_partial::<&[f32]>(None, None)
            } else {
                resampler.process_partial(Some(&[pending.as_slice()]), None)
            }
            .map_err(|_| "Не удалось завершить звук")?;
            append(output, &mut samples, &mut delay);
            let target =
                (padding + (frames as u64 * RATE as u64 / source_rate as u64) as usize).min(limit);
            if samples.len() < target {
                append(
                    resampler
                        .process_partial::<&[f32]>(None, None)
                        .map_err(|_| "Не удалось завершить звук")?,
                    &mut samples,
                    &mut delay,
                );
            }
            samples.truncate(target);
        }
    }
    if samples.len() < RATE as usize * 5 {
        return Err("Слишком мало звука для синхронизации".into());
    }
    Ok(samples)
}

async fn clip_audio(http: &Client, url: Url) -> Result<(Vec<u8>, f64), String> {
    let mut next = url;
    let mut visited = HashSet::new();
    let mut segments = None;
    for _ in 0..3 {
        if !visited.insert(next.to_string()) {
            return Err("Зацикленный плейлист клипа".into());
        }
        let (body, final_url) = bytes_at(http, next, PLAYLIST_BYTES).await?;
        match playlist(&body, &final_url)? {
            Playlist::Next(url) => next = url,
            Playlist::Segments(list) => {
                segments = Some(list);
                break;
            }
        }
    }
    let segments = segments.ok_or("Слишком много вложенных плейлистов клипа")?;
    let mut spent = 0usize;
    let mut demuxer = TsAudio::default();
    let mut raw_aac: Option<Vec<u8>> = None;
    let mut raw_seconds = 0.0;
    for segment in segments {
        let remaining = CLIP_BYTES.saturating_sub(spent).min(SEGMENT_BYTES);
        if remaining == 0 {
            return Err("Клип слишком большой для синхронизации".into());
        }
        let (body, _) = bytes_at(http, segment.url, remaining).await?;
        spent += body.len();
        // AAC-only HLS has no video PES. Its concatenated frame durations must
        // agree with the playlist clock. ID3-packed audio and fMP4 stay unsupported.
        if body.starts_with(&[0xff, 0xf1]) {
            if !demuxer.audio.is_empty() {
                return Err("Контейнер звука меняется внутри клипа".into());
            }
            let (frames, rate) = adts_info(&body)?;
            if (raw_seconds - segment.start).abs() > 0.06 {
                return Err("Временная шкала AAC клипа меняется".into());
            }
            raw_seconds += frames as f64 / rate as f64;
            let audio = raw_aac.get_or_insert_with(Vec::new);
            if audio.len().saturating_add(body.len()) > AUDIO_BYTES {
                return Err("Звуковая дорожка клипа слишком большая".into());
            }
            audio.extend_from_slice(&body);
            continue;
        }
        if raw_aac.is_some() {
            return Err("Контейнер звука меняется внутри клипа".into());
        }
        demuxer.push_segment(&body, segment.start)?;
    }
    if let Some(audio) = raw_aac {
        validate_adts(&audio)?;
        return Ok((audio, 0.0));
    }
    demuxer.finish()
}

/// Loads exactly the user's authorized song rendition and the official clip.
/// The caller handles matching confidence; a failed input never changes playback.
pub async fn load_audio_pair(
    track_id: &str,
    clip_id: &str,
    yandex: &Yandex,
) -> Result<(Vec<f32>, Vec<f32>, u32), String> {
    let valid_id = |id: &str| {
        !id.is_empty()
            && id.len() <= 20
            && id.bytes().all(|byte| byte.is_ascii_digit())
            && id.bytes().any(|byte| byte != b'0')
    };
    if !valid_id(track_id) || !valid_id(clip_id) {
        return Err("Неверный идентификатор для синхронизации".into());
    }
    let deadline = Instant::now() + DEADLINE;
    let work = async {
        let http = Client::builder()
            .user_agent(UA)
            .connect_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| "Не удалось подготовить синхронизацию клипа")?;
        let (track, clip) =
            tokio::try_join!(yandex.stream(track_id, "low"), yandex.clip_stream(clip_id))?;
        if track.track_id != track_id || clip.clip_id != clip_id || clip.kind != "hls" {
            return Err("Не удалось сопоставить звук и клип".into());
        }
        let track_url = media_url(&track.url, None)?;
        let clip_url = media_url(&clip.url, None)?;
        let ((track_bytes, _), (clip_bytes, lead)) = tokio::try_join!(
            bytes_at(&http, track_url, TRACK_BYTES),
            clip_audio(&http, clip_url)
        )?;
        let extension = if track.codec.to_ascii_lowercase().contains("mp3") {
            "mp3"
        } else {
            "aac"
        };
        tauri::async_runtime::spawn_blocking(move || {
            let song = decode_mono(track_bytes, extension, 0.0, deadline)?;
            let video = decode_mono(clip_bytes, "aac", lead, deadline)?;
            Ok((song, video, RATE))
        })
        .await
        .map_err(|_| "Не удалось обработать звук клипа".to_owned())?
    };
    tokio::time::timeout(DEADLINE, work)
        .await
        .map_err(|_| "Синхронизация клипа заняла слишком много времени".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pts(value: u64) -> [u8; 5] {
        [
            0x21 | (((value >> 30) as u8 & 7) << 1),
            (value >> 22) as u8,
            (((value >> 15) as u8 & 127) << 1) | 1,
            (value >> 7) as u8,
            ((value as u8 & 127) << 1) | 1,
        ]
    }
    fn pes(data: &[u8], stamp: u64) -> Vec<u8> {
        let length = (data.len() + 8) as u16;
        let mut result = vec![
            0,
            0,
            1,
            0xc0,
            (length >> 8) as u8,
            length as u8,
            0x80,
            0x80,
            5,
        ];
        result.extend_from_slice(&pts(stamp));
        result.extend_from_slice(data);
        result
    }
    fn ts(pid: u16, cc: u8, begins: bool, bytes: &[u8]) -> Vec<u8> {
        assert!(bytes.len() <= 182);
        let mut packet = vec![0xff; 188];
        packet[..4].copy_from_slice(&[
            0x47,
            (pid >> 8) as u8 | if begins { 0x40 } else { 0 },
            pid as u8,
            0x30 | cc,
        ]);
        packet[4] = (183 - bytes.len()) as u8;
        packet[5] = 0;
        packet[188 - bytes.len()..].copy_from_slice(bytes);
        packet
    }
    fn frame(payload: usize) -> Vec<u8> {
        let length = payload + 7;
        let mut frame = vec![
            0xff,
            0xf1,
            0x4c,
            0x80 | ((length >> 11) as u8 & 3),
            (length >> 3) as u8,
            ((length as u8 & 7) << 5) | 31,
            0xfc,
        ];
        frame.extend(std::iter::repeat(0x25).take(payload));
        frame
    }

    #[test]
    fn playlist_selects_lowest_variant_and_never_follows_untrusted_encryption_or_urls() {
        let base = Url::parse("https://strm.yandex.ru/test/master.m3u8").unwrap();
        let master = b"#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000,CODECS=\"avc1.64001e,mp4a.40.2\"\nhigh.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=100000,CODECS=\"avc1.64000c,mp4a.40.2\"\nlow.m3u8\n";
        assert!(
            matches!(playlist(master, &base).unwrap(), Playlist::Next(url) if url.as_str().ends_with("/test/low.m3u8"))
        );
        let valid = "#EXTM3U\n#EXTINF:4,\na.ts\n#EXTINF:4,\nb.ts\n#EXT-X-ENDLIST\n";
        let Playlist::Segments(segments) = playlist(valid.as_bytes(), &base).unwrap() else {
            panic!()
        };
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[1].start, 4.0);
        for bad in [
            valid.replace("a.ts", "http://strm.yandex.ru/a.ts"),
            valid.replace("a.ts", "https://evil.test/a.ts"),
            valid.replace(
                "#EXTINF:4,",
                "#EXT-X-KEY:METHOD=AES-128,URI=\"key\"\n#EXTINF:4,",
            ),
            valid.replace("#EXTINF:4,", "#EXT-X-DISCONTINUITY\n#EXTINF:4,"),
            valid.replace("#EXT-X-ENDLIST", ""),
            valid.replace("#EXTINF:4,", "#EXTINF:NaN,"),
            valid.replace("a.ts", "https://strm.yandex.ru@127.0.0.1/a.ts"),
        ] {
            assert!(playlist(bad.as_bytes(), &base).is_err());
        }
        assert!(playlist(&vec![b'x'; PLAYLIST_BYTES + 1], &base).is_err());
        let oversized = format!(
            "#EXTM3U\n{}#EXT-X-ENDLIST\n",
            "#EXTINF:1,\na.ts\n".repeat(MAX_SEGMENTS + 1)
        );
        assert!(playlist(oversized.as_bytes(), &base).is_err());
        assert!(media_url("https://strm.yandex.ru.evil.test/a", None).is_err());
        assert!(media_url("https://user@strm.yandex.ru/a", None).is_err());
        assert!(media_url("https://strm.yandex.ru:8443/a", None).is_err());
    }

    #[test]
    fn ts_demux_handles_fragmented_pes_headers_adaptation_and_packet_lengths() {
        let audio = frame(260);
        let packet = pes(&audio, 900_000);
        let mut demuxer = TsAudio::default();
        let mut transport = ts(257, 0, true, &packet[..3]);
        transport.extend(ts(257, 1, false, &packet[3..11]));
        transport.extend(ts(257, 2, false, &packet[11..190]));
        transport.extend(ts(257, 3, false, &packet[190..]));
        demuxer.push_segment(&transport, 0.0).unwrap();
        let (decoded, lead) = demuxer.finish().unwrap();
        assert_eq!(decoded, audio);
        assert_eq!(lead, 0.0);
    }

    #[test]
    fn ts_demux_rejects_missing_audio_packets_and_timestamp_discontinuity() {
        let audio = frame(200);
        let packet = pes(&audio, 0);
        let mut broken = ts(257, 0, true, &packet[..100]);
        broken.extend(ts(257, 2, false, &packet[100..]));
        assert!(TsAudio::default().push_segment(&broken, 0.0).is_err());
        let mut demuxer = TsAudio::default();
        demuxer
            .push_segment(&ts(257, 0, true, &pes(&frame(10), 900_000)), 0.0)
            .unwrap();
        assert!(demuxer
            .push_segment(&ts(257, 0, true, &pes(&frame(10), 990_000)), 4.0)
            .is_err());
        assert_eq!(pts_delta(50, (1 << 33) - 50), 100);
        assert_eq!(pts_delta((1 << 33) - 50, 50), -100);
    }

    #[test]
    fn ts_audio_lead_is_relative_to_video_time_not_an_arbitrary_pts_origin() {
        let mut video = pes(&[0x11; 20], 900_000);
        video[3] = 0xe0;
        let mut data = ts(256, 0, true, &video);
        data.extend(ts(257, 0, true, &pes(&frame(20), 909_000)));
        let mut demuxer = TsAudio::default();
        demuxer.push_segment(&data, 0.0).unwrap();
        let (_, lead) = demuxer.finish().unwrap();
        assert!((lead - 0.1).abs() < 1e-9);
    }

    #[tokio::test]
    async fn invalid_identifiers_fail_before_resolving_an_authenticated_stream() {
        let yandex = Yandex::new("");
        for (track, clip) in [
            ("../account/status", "1"),
            ("1", "2?ids=3"),
            ("0", "1"),
            ("local:123", "1"),
        ] {
            assert!(load_audio_pair(track, clip, &yandex).await.is_err());
        }
    }

    #[test]
    fn adts_rejects_partial_or_changing_audio_instead_of_shifting_the_clock() {
        let audio = frame(20);
        validate_adts(&audio).unwrap();
        assert!(validate_adts(&audio[..audio.len() - 1]).is_err());
        let mut changed = audio.clone();
        changed[2] = 0x50;
        assert!(validate_adts(&[audio.as_slice(), changed.as_slice()].concat()).is_err());
        let mut protected = audio;
        protected[1] = 0xf0;
        assert!(validate_adts(&protected).is_err());
    }

    #[test]
    #[ignore = "Optional local public-media evidence; no network or credentials"]
    fn public_media_decoder_smoke() {
        let root = std::path::PathBuf::from(
            std::env::var("AUREON_CLIP_SYNC_FIXTURE_DIR").expect("fixture directory"),
        );
        let song = decode_mono(
            std::fs::read(root.join("clip-sync-dynasty-public-preview.mp3")).unwrap(),
            "mp3",
            0.0,
            Instant::now() + DEADLINE,
        )
        .unwrap();
        let mut ts = TsAudio::default();
        ts.push_segment(
            &std::fs::read(root.join("clip-check-624687.ts")).unwrap(),
            0.0,
        )
        .unwrap();
        let (audio, lead) = ts.finish().unwrap();
        // The local segment is only four seconds; combine twice for this smoke
        // test's minimum duration, not as a runtime alignment reference.
        let clip = decode_mono(
            [audio.as_slice(), audio.as_slice()].concat(),
            "aac",
            lead,
            Instant::now() + DEADLINE,
        )
        .unwrap();
        assert!((song.len() as f64 / RATE as f64 - 30.0).abs() < 0.1);
        assert!(clip.len() > RATE as usize * 7);
        let bytes: Vec<u8> = song.iter().flat_map(|value| value.to_le_bytes()).collect();
        std::fs::write(root.join("clip-sync-dynasty-preview-rust.f32"), bytes).unwrap();
    }

    #[tokio::test]
    #[ignore = "Optional public Yandex network smoke, no credentials"]
    async fn public_dynasty_full_hls_smoke() {
        let root = std::path::PathBuf::from(
            std::env::var("AUREON_CLIP_SYNC_FIXTURE_DIR").expect("fixture directory"),
        );
        let http = Client::builder()
            .user_agent(UA)
            .timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let url = media_url("https://frontend.vh.yandex.ru/player/7043311152126062465.json?service=ya-music&from=ya-music&hidden=*", None).unwrap();
        let (body, _) = bytes_at(&http, url, 2 * 1024 * 1024).await.unwrap();
        let document: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let hls = document["content"]["streams"]
            .as_array()
            .unwrap()
            .iter()
            .find(|stream| stream["stream_type"] == "HLS")
            .unwrap()["url"]
            .as_str()
            .unwrap();
        let (aac, lead) =
            tokio::time::timeout(DEADLINE, clip_audio(&http, media_url(hls, None).unwrap()))
                .await
                .unwrap()
                .unwrap();
        let samples = decode_mono(aac, "aac", lead, Instant::now() + DEADLINE).unwrap();
        println!(
            "Public Dynasty decoded: {}s, audio lead {}s",
            samples.len() as f64 / RATE as f64,
            lead
        );
        assert!(samples.len() > RATE as usize * 160 && samples.len() < RATE as usize * 170);
        // Optional test artifact only. Runtime acquisition never writes media.
        let bytes: Vec<u8> = samples
            .iter()
            .flat_map(|value| value.to_le_bytes())
            .collect();
        std::fs::write(root.join("clip-sync-dynasty-rust.f32"), bytes).unwrap();
    }
}
