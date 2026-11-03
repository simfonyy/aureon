use rustfft::{num_complex::Complex, FftPlanner};
use serde::Serialize;

const MAX_SECONDS: usize = 300;
const MAX_OFFSET_SECONDS: f64 = 60.0;
const WINDOW_COUNT: usize = 6;
const MIN_CORRELATION: f64 = 0.38;
const MAX_OFFSET_SPREAD: f64 = 0.12;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipAlignment {
    /// A frame at track time T belongs at video time T + offset_seconds.
    pub offset_seconds: f64,
    /// Mean normalized waveform correlation of independently matched windows.
    /// This measures acoustic similarity, rather than a statistical probability.
    pub confidence: f64,
    pub matched_windows: usize,
    pub analyzed_seconds: f64,
}

#[derive(Debug)]
struct WindowMatch {
    at: f64,
    offset: f64,
    score: f64,
}

/// Match already decoded mono PCM. Both inputs must use `rate`; no duration or
/// title heuristics participate in the result. Music with edits or insufficient
/// unique common audio is deliberately left without an automatic alignment.
pub fn align_audio(track: &[f32], clip: &[f32], rate: u32) -> Result<ClipAlignment, String> {
    if !(1_000..=48_000).contains(&rate) {
        return Err("Не удалось сопоставить частоту аудио.".into());
    }
    let max_samples = MAX_SECONDS * rate as usize;
    if track.len() > max_samples || clip.len() > max_samples {
        return Err("Фрагмент для синхронизации слишком длинный.".into());
    }
    if track.len() < rate as usize * 16 || clip.len() < rate as usize * 8 {
        return Err("Для синхронизации нужно больше общего звука.".into());
    }
    if track.iter().chain(clip).any(|sample| !sample.is_finite()) {
        return Err("Не удалось прочитать звук для синхронизации.".into());
    }

    // The runtime supplies 4 kHz PCM. Keep higher-rate callers bounded as well;
    // identical averaging and high-pass filtering preserve timing in both files.
    let stride = (rate as usize / 4_000).max(1);
    let match_rate = rate as f64 / stride as f64;
    let track = prepare(track, stride, match_rate);
    let clip = prepare(clip, stride, match_rate);
    let duration = track.len() as f64 / match_rate;
    let window_len = ((if duration < 30.0 { 4.0 } else { 6.0 }) * match_rate) as usize;
    let mean_track_energy = track
        .iter()
        .map(|sample| f64::from(*sample).powi(2))
        .sum::<f64>()
        / track.len() as f64;
    let mean_clip_energy = clip
        .iter()
        .map(|sample| f64::from(*sample).powi(2))
        .sum::<f64>()
        / clip.len() as f64;
    if mean_track_energy < 1e-10 || mean_clip_energy < 1e-10 {
        return Err("В этих фрагментах недостаточно слышимого звука.".into());
    }
    if clip.len() < window_len {
        return Err("Для синхронизации нужно больше общего звука.".into());
    }

    let mut clip_sum = Vec::with_capacity(clip.len() + 1);
    let mut clip_energy = Vec::with_capacity(clip.len() + 1);
    clip_sum.push(0.0_f64);
    clip_energy.push(0.0_f64);
    for sample in &clip {
        let value = f64::from(*sample);
        clip_sum.push(clip_sum.last().copied().unwrap_or_default() + value);
        clip_energy.push(clip_energy.last().copied().unwrap_or_default() + value * value);
    }

    // One clip FFT is shared across every window. Only one work buffer is kept,
    // so a five-minute 4 kHz pair stays well below a full per-window FFT cache.
    let fft_len = (clip.len() + window_len - 1).next_power_of_two();
    let mut planner = FftPlanner::<f32>::new();
    let forward = planner.plan_fft_forward(fft_len);
    let inverse = planner.plan_fft_inverse(fft_len);
    let mut clip_fft = vec![Complex::new(0.0, 0.0); fft_len];
    for (slot, sample) in clip_fft.iter_mut().zip(&clip) {
        slot.re = *sample;
    }
    let mut scratch = vec![
        Complex::new(0.0, 0.0);
        forward
            .get_inplace_scratch_len()
            .max(inverse.get_inplace_scratch_len())
    ];
    forward.process_with_scratch(&mut clip_fft, &mut scratch);
    let mut work = vec![Complex::new(0.0, 0.0); fft_len];
    let maximum_shift = (MAX_OFFSET_SECONDS * match_rate) as usize;
    let peak_separation = (0.5 * match_rate) as usize;
    let mut matches = Vec::with_capacity(WINDOW_COUNT);

    for index in 0..WINDOW_COUNT {
        let start = ((track.len() - window_len) as f64 * (index as f64 + 0.5) / WINDOW_COUNT as f64)
            .round() as usize;
        let window = &track[start..start + window_len];
        let mean = window.iter().map(|sample| f64::from(*sample)).sum::<f64>() / window_len as f64;
        let energy = window
            .iter()
            .map(|sample| (f64::from(*sample) - mean).powi(2))
            .sum::<f64>();
        if energy / (window_len as f64) < mean_track_energy * 0.06 {
            continue;
        }
        let from = start.saturating_sub(maximum_shift);
        let to = (start + maximum_shift).min(clip.len() - window_len);
        if from > to {
            continue;
        }

        work.fill(Complex::new(0.0, 0.0));
        for (slot, sample) in work.iter_mut().zip(window.iter().rev()) {
            slot.re = (*sample as f64 - mean) as f32;
        }
        forward.process_with_scratch(&mut work, &mut scratch);
        for (value, source) in work.iter_mut().zip(&clip_fft) {
            *value *= *source;
        }
        inverse.process_with_scratch(&mut work, &mut scratch);

        let correlation = |position: usize| {
            let sum = clip_sum[position + window_len] - clip_sum[position];
            let variance = clip_energy[position + window_len]
                - clip_energy[position]
                - sum * sum / window_len as f64;
            if variance <= 1e-12 {
                return 0.0;
            }
            let dot = work[position + window_len - 1].re as f64 / fft_len as f64;
            (dot.abs() / (energy * variance).sqrt()).min(1.0)
        };
        let (mut best_at, mut best) = (from, 0.0_f64);
        for position in from..=to {
            let score = correlation(position);
            if score > best {
                best_at = position;
                best = score;
            }
        }
        if best < MIN_CORRELATION {
            continue;
        }
        let mut second = 0.0_f64;
        for position in from..=to {
            if position.abs_diff(best_at) > peak_separation {
                second = second.max(correlation(position));
            }
        }
        // Repeated beats/choruses can yield several equally convincing places.
        // Such a window cannot vote for one of them merely because it is first.
        if best - second < 0.06 || best < second * 1.12 {
            continue;
        }
        matches.push(WindowMatch {
            at: (start as f64 + window_len as f64 * 0.5) / match_rate,
            offset: (best_at as f64 - start as f64) / match_rate,
            score: best,
        });
    }

    if matches.len() < 3 {
        return Err("Не нашли достаточно однозначных совпадений в звуке.".into());
    }
    let minimum = matches
        .iter()
        .map(|item| item.offset)
        .fold(f64::INFINITY, f64::min);
    let maximum = matches
        .iter()
        .map(|item| item.offset)
        .fold(f64::NEG_INFINITY, f64::max);
    if maximum - minimum > MAX_OFFSET_SPREAD {
        return Err("В клипе меняется монтаж или скорость: общий сдвиг не подходит.".into());
    }
    let coverage = matches.last().unwrap().at - matches.first().unwrap().at;
    if coverage < 30.0 && coverage < duration * 0.5 {
        return Err("Совпадения расположены слишком близко друг к другу.".into());
    }
    let confidence = matches.iter().map(|item| item.score).sum::<f64>() / matches.len() as f64;
    if confidence < 0.45 {
        return Err("Совпадения в звуке недостаточно точные.".into());
    }
    let mut offsets: Vec<_> = matches.iter().map(|item| item.offset).collect();
    offsets.sort_by(f64::total_cmp);
    let middle = offsets.len() / 2;
    let offset = if offsets.len() % 2 == 0 {
        (offsets[middle - 1] + offsets[middle]) * 0.5
    } else {
        offsets[middle]
    };
    Ok(ClipAlignment {
        offset_seconds: offset,
        confidence,
        matched_windows: matches.len(),
        analyzed_seconds: duration,
    })
}

fn prepare(input: &[f32], stride: usize, rate: f64) -> Vec<f32> {
    let coefficient = (-std::f64::consts::TAU * 70.0 / rate).exp() as f32;
    let (mut previous_input, mut previous_output) = (0.0, 0.0);
    input
        .chunks(stride)
        .map(|chunk| {
            let sample = chunk.iter().sum::<f32>() / chunk.len() as f32;
            let output = coefficient * (previous_output + sample - previous_input);
            previous_input = sample;
            previous_output = output;
            output
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 1_000;
    fn noise(seconds: usize, mut seed: u64) -> Vec<f32> {
        (0..seconds * RATE as usize)
            .map(|index| {
                seed = seed.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1);
                let random = ((seed >> 40) as f32 / (1_u32 << 24) as f32 - 0.5) * 0.5;
                random * (0.5 + 0.4 * (index as f32 * 0.000_23).sin())
            })
            .collect()
    }
    fn shifted(source: &[f32], offset: i32) -> Vec<f32> {
        if offset >= 0 {
            let mut clip = noise(offset as usize, 913);
            clip.extend_from_slice(source);
            clip
        } else {
            source[(-offset) as usize * RATE as usize..].to_vec()
        }
    }

    #[test]
    fn matches_positive_offset_despite_gain_dc_noise_and_codec_like_soft_clipping() {
        let track = noise(96, 17);
        let mut clip = shifted(&track, 11);
        let interference = noise(clip.len() / RATE as usize, 299);
        for (sample, extra) in clip.iter_mut().zip(interference) {
            *sample = (*sample * 1.7).tanh() * 0.5 + extra * 0.04 + 0.12;
        }
        let result = align_audio(&track, &clip, RATE).unwrap();
        assert!((result.offset_seconds - 11.0).abs() < 0.002);
        assert!(result.confidence > 0.9);
        assert!(result.matched_windows >= 3);
        assert_eq!(result.analyzed_seconds, 96.0);
    }

    #[test]
    fn matches_negative_offset_when_video_music_starts_after_the_track_beginning() {
        let track = noise(100, 51);
        let result = align_audio(&track, &shifted(&track, -7), RATE).unwrap();
        assert!((result.offset_seconds + 7.0).abs() < 0.002);
        assert!(result.matched_windows >= 4);
    }

    #[test]
    fn a_real_zero_offset_is_measured_from_audio() {
        let track = noise(38, 89);
        let result = align_audio(&track, &track, RATE).unwrap();
        assert!(result.offset_seconds.abs() < 0.001);
        assert!(result.confidence > 0.99);
    }

    #[test]
    fn keeps_subsecond_offsets_and_accepts_inverted_audio_polarity() {
        let track = noise(42, 817);
        let lead = 237_usize;
        let mut clip = vec![0.0; lead];
        clip.extend(track.iter().map(|sample| -*sample * 0.3));
        let result = align_audio(&track, &clip, RATE).unwrap();
        assert!((result.offset_seconds - lead as f64 / RATE as f64).abs() < 0.002);
        assert!(result.confidence > 0.99);
    }

    #[test]
    fn excludes_quiet_intro_and_still_requires_separated_matches() {
        let mut track = noise(120, 71);
        track[..35 * RATE as usize].fill(0.0);
        let result = align_audio(&track, &shifted(&track, 4), RATE).unwrap();
        assert!((result.offset_seconds - 4.0).abs() < 0.002);
        assert!(result.matched_windows >= 3);
    }

    #[test]
    fn silence_unrelated_music_and_invalid_input_never_produce_a_fake_zero() {
        let track = noise(70, 81);
        assert!(align_audio(&track, &noise(70, 449), RATE).is_err());
        assert!(align_audio(&track, &noise(110, 871), RATE).is_err());
        assert!(align_audio(&vec![0.0; track.len()], &track, RATE).is_err());
        assert!(align_audio(&track, &vec![0.0; track.len()], RATE).is_err());
        assert!(align_audio(&track, &track, 0).is_err());
        let mut invalid = track.clone();
        invalid[3] = f32::NAN;
        assert!(align_audio(&invalid, &track, RATE).is_err());
    }

    #[test]
    fn repeated_passages_are_ambiguous_even_with_perfect_waveform_correlation() {
        let phrase = noise(5, 315);
        let track: Vec<_> = phrase
            .iter()
            .copied()
            .cycle()
            .take(80 * RATE as usize)
            .collect();
        let clip: Vec<_> = phrase
            .iter()
            .copied()
            .cycle()
            .take(100 * RATE as usize)
            .collect();
        assert!(align_audio(&track, &clip, RATE).is_err());
    }

    #[test]
    fn an_inserted_scene_changes_offset_and_is_not_treated_as_a_constant_shift() {
        let track = noise(100, 191);
        let split = 48 * RATE as usize;
        let mut clip = track[..split].to_vec();
        clip.extend(noise(4, 671));
        clip.extend_from_slice(&track[split..]);
        assert!(align_audio(&track, &clip, RATE).is_err());
    }

    #[test]
    fn gradual_tempo_drift_and_over_sixty_second_offsets_are_not_accepted() {
        let track = noise(100, 515);
        let slow: Vec<_> = (0..track.len())
            .map(|index| track[((index as f64 * 0.99) as usize).min(track.len() - 1)])
            .collect();
        assert!(align_audio(&track, &slow, RATE).is_err());
        assert!(align_audio(&track, &shifted(&track, 65), RATE).is_err());
    }
}
