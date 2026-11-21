"""Helper exit with a live parent pipe, plus opt-in model cancellation."""
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import tempfile
import time
import unittest


class LifecycleTest(unittest.TestCase):
    def test_normal_success_exits_while_parent_pipe_remains_open(self):
        # communicate() would close stdin and hide the shutdown regression.
        # A stopword-only song needs no GPU, but exercises the actual CLI,
        # parent-watcher daemon, result write and normal interpreter shutdown.
        with tempfile.TemporaryDirectory(prefix='aureon-fx-normal-exit-') as temp:
            directory=Path(temp);source=directory/'input.json';output=directory/'result.json'
            source.write_text(json.dumps({'sourceKey':'normal-exit-test','transcript':'Она',
                'words':[{'id':'w0','text':'Она','startMs':0,'endMs':400,'lineId':'l0'}],
                'lines':[{'id':'l0','wordIds':['w0']}]}),encoding='utf-8')
            for attempt in range(3):
                with self.subTest(attempt=attempt):
                    process=subprocess.Popen([sys.executable,str(Path(__file__).with_name('selector.py')),
                        '--input',str(source),'--output',str(output),'--runtime',str(directory/'absent-runtime'),'--watch-parent'],
                        stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
                    try:
                        self.assertEqual(0,process.wait(timeout=8))
                        self.assertFalse(process.stdin.closed,'Parent pipe must still be held open at helper exit')
                        self.assertEqual({'status':'ready','candidates':[]},json.loads(output.read_text(encoding='utf-8')))
                        self.assertEqual(b'',process.stderr.read())
                    finally:
                        if process.poll() is None:
                            process.kill();process.wait(timeout=3)
                        process.stdin.close();process.stderr.close()

    @unittest.skipUnless(os.environ.get('AUREON_LYRICS_FX_RUNTIME'),'Set AUREON_LYRICS_FX_RUNTIME for the real model check')
    def test_parent_pipe_closure_stops_inference_server(self):
        runtime=Path(os.environ['AUREON_LYRICS_FX_RUNTIME'])
        with tempfile.TemporaryDirectory(prefix='aureon-fx-lifecycle-') as temp:
            directory=Path(temp);source=directory/'input.json';output=directory/'result.json'
            text='Тяжёлый образ в этой фразе'
            words=[{'id':f'w{i}','text':word,'startMs':i*500,'endMs':i*500+400,'lineId':'l0'} for i,word in enumerate(text.split())]
            source.write_text(json.dumps({'sourceKey':'lifecycle-test','transcript':text,'words':words,'lines':[{'id':'l0','wordIds':[w['id'] for w in words]}]},ensure_ascii=False),encoding='utf-8')
            process=subprocess.Popen([sys.executable,str(Path(__file__).with_name('selector.py')),
                '--input',str(source),'--output',str(output),'--runtime',str(runtime),'--watch-parent','--timeout','30'],
                stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            try:
                deadline=time.monotonic()+20;port=None
                while time.monotonic()<deadline:
                    log=output.with_suffix('.llama.log')
                    if log.exists():
                        match=re.search(r'listening on http://127\.0\.0\.1:(\d+)',log.read_text(encoding='utf-8',errors='replace'))
                        if match:port=int(match[1]);break
                    if process.poll() is not None:break
                    time.sleep(.05)
                self.assertIsNotNone(port,'Model server did not start before cancellation test')
                process.stdin.close()
                self.assertEqual(3,process.wait(timeout=8))
                with self.assertRaises(OSError):
                    socket.create_connection(('127.0.0.1',port),timeout=.5)
            finally:
                if process.poll() is None:
                    process.stdin.close();process.kill();process.wait(timeout=3)
                if process.stderr:process.stderr.close()


if __name__=='__main__':unittest.main()
