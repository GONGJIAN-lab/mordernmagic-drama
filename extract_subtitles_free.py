#!/usr/bin/env python3
import os
import sys
import boto3
import subprocess
import tempfile
import json
import time

AWS_ACCESS_KEY_ID = os.environ.get("AWS_ACCESS_KEY_ID", "")
AWS_SECRET_ACCESS_KEY = os.environ.get("AWS_SECRET_ACCESS_KEY", "")
AWS_REGION = "us-east-1"
S3_BUCKET = "mordernmagic-drama-media"
VIDEO_PREFIX = "dramas/chuan-jin-nue-wen/"
SUBTITLE_PREFIX = "subtitles/en/"
EPISODES = list(range(1, 46))
PROGRESS_FILE = "subtitle_progress.json"
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "base")

def load_progress():
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE, "r") as f:
            return json.load(f)
    return {"done": [], "failed": []}

def save_progress(progress):
    with open(PROGRESS_FILE, "w") as f:
        json.dump(progress, f, indent=2)

def get_s3_client():
    return boto3.client("s3", region_name=AWS_REGION, aws_access_key_id=AWS_ACCESS_KEY_ID, aws_secret_access_key=AWS_SECRET_ACCESS_KEY)

def download_video(s3, episode_num, local_path):
    key = f"{VIDEO_PREFIX}ep{episode_num:02d}.mp4"
    print(f"[EP{episode_num:02d}] 下载: {key}")
    s3.download_file(S3_BUCKET, key, local_path)
    size_mb = os.path.getsize(local_path) / (1024 * 1024)
    print(f"[EP{episode_num:02d}] 完成: {size_mb:.1f} MB")
    return local_path

def extract_audio(video_path, audio_path):
    cmd = ["ffmpeg", "-y", "-i", video_path, "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", audio_path]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    return audio_path

def transcribe_whisper(audio_path):
    import whisper
    print(f"[Whisper] 加载 {WHISPER_MODEL} 模型...")
    model = whisper.load_model(WHISPER_MODEL)
    print("[Whisper] 开始识别...")
    result = model.transcribe(audio_path, language="zh", verbose=False)
    segments = []
    for seg in result["segments"]:
        segments.append({"start": seg["start"], "end": seg["end"], "text": seg["text"].strip()})
    print(f"[Whisper] 识别到 {len(segments)} 段")
    return segments

def translate_segments(segments):
    from deep_translator import GoogleTranslator
    translator = GoogleTranslator(source="zh-CN", target="en")
    print(f"[Translate] 翻译 {len(segments)} 段...")
    for i, seg in enumerate(segments):
        if seg["text"]:
            try:
                seg["text"] = translator.translate(seg["text"])
                time.sleep(0.5)
            except Exception as e:
                print(f"[Warn] 第 {i+1} 段翻译失败: {e}")
        if (i + 1) % 10 == 0 or i == len(segments) - 1:
            print(f"[Translate] {i+1}/{len(segments)}")
    return segments

def generate_srt(segments, srt_path):
    def fmt(seconds):
        h = int(seconds // 3600)
        m = int((seconds % 3600) // 60)
        s = int(seconds % 60)
        ms = int((seconds - int(seconds)) * 1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
    with open(srt_path, "w", encoding="utf-8") as f:
        idx = 1
        for seg in segments:
            if not seg["text"]:
                continue
            f.write(f"{idx}\n")
            f.write(f"{fmt(seg['start'])} --> {fmt(seg['end'])}\n")
            f.write(f"{seg['text']}\n\n")
            idx += 1
    print(f"[SRT] 已生成: {srt_path}")
    return srt_path

def upload_srt(s3, srt_path, episode_num):
    key = f"{SUBTITLE_PREFIX}ep{episode_num:02d}.srt"
    print(f"[S3] 上传: {key}")
    s3.upload_file(srt_path, S3_BUCKET, key)
    print("[S3] 完成")
    return key

def process_episode(s3, episode_num, tmpdir):
    video_path = os.path.join(tmpdir, f"ep{episode_num:02d}.mp4")
    audio_path = os.path.join(tmpdir, f"ep{episode_num:02d}.wav")
    srt_path = os.path.join(tmpdir, f"ep{episode_num:02d}.srt")
    try:
        download_video(s3, episode_num, video_path)
        extract_audio(video_path, audio_path)
        segments = transcribe_whisper(audio_path)
        if segments:
            segments = translate_segments(segments)
            generate_srt(segments, srt_path)
            upload_srt(s3, srt_path, episode_num)
        else:
            print(f"[EP{episode_num:02d}] 无字幕，跳过")
        for f in [video_path, audio_path, srt_path]:
            if os.path.exists(f):
                os.remove(f)
        return True
    except Exception as e:
        print(f"[EP{episode_num:02d}] 失败: {e}")
        return False

def main():
    if not AWS_ACCESS_KEY_ID or not AWS_SECRET_ACCESS_KEY:
        print("[Error] 请设置 AWS_ACCESS_KEY_ID 和 AWS_SECRET_ACCESS_KEY")
        sys.exit(1)
    print("=" * 50)
    print("模式: 完全免费（本地 Whisper + 免费翻译）")
    print(f"模型: {WHISPER_MODEL}")
    print(f"总集数: {len(EPISODES)}")
    print("=" * 50)
    s3 = get_s3_client()
    progress = load_progress()
    todo = [ep for ep in EPISODES if ep not in progress["done"]]
    print(f"待处理: {len(todo)} 集 | 已完成: {len(progress['done'])} 集\n")
    with tempfile.TemporaryDirectory() as tmpdir:
        for episode_num in todo:
            print(f"\n{'='*20} EP{episode_num:02d} {'='*20}")
            t0 = time.time()
            ok = process_episode(s3, episode_num, tmpdir)
            elapsed = time.time() - t0
            print(f"耗时: {elapsed:.0f} 秒")
            if ok:
                progress["done"].append(episode_num)
            else:
                progress["failed"].append(episode_num)
            save_progress(progress)
    print(f"\n{'='*50}")
    print(f"完成: {len(progress['done'])} 集")
    print(f"失败: {len(progress['failed'])} 集")
    if progress["failed"]:
        print(f"失败列表: {progress['failed']}")
    print("=" * 50)

if __name__ == "__main__":
    main()
