import json, pathlib, subprocess, sys, html, re
from PIL import Image, ImageOps, ImageDraw
root=pathlib.Path(__file__).resolve().parent
ffmpeg='/tmp/yolo-video-tools/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2'
items=json.loads((root/'manifest.json').read_text())
for item in items:
    name=item['name']
    out=root/'clips'/f'{name}.mp4'
    frame_dir=root/'work'/name
    cfr=frame_dir/'cfr'
    cfr.mkdir(exist_ok=True)
    frame=0
    elapsed=0
    for filename,duration in re.findall(r"file '([^']+)'\nduration ([0-9.]+)", (frame_dir/'frames.ffconcat').read_text()):
        elapsed+=float(duration)
        end=round(elapsed*30)
        while frame<end:
            link=cfr/f'{frame:05d}.jpg'
            if link.exists(): link.unlink()
            link.symlink_to(frame_dir/filename)
            frame+=1
    subprocess.run([ffmpeg,'-hide_banner','-loglevel','error','-y','-framerate','30','-i',str(cfr/'%05d.jpg'),'-vf','scale=1920:1080:flags=lanczos,setsar=1','-c:v','libx264','-preset','fast','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart','-an',str(out)],check=True)
    print('Encoded',name,flush=True)
    # Decode every frame to catch damaged streams before delivery.
    subprocess.run([ffmpeg,'-hide_banner','-loglevel','error','-i',str(out),'-f','null','-'],check=True)
    subprocess.run([ffmpeg,'-hide_banner','-loglevel','error','-y','-ss',str(max(0,item['duration']-4)),'-i',str(out),'-t','4','-c:v','libx264','-preset','fast','-crf','20','-an',str(root/'work'/f'{name}-select.mp4')],check=True)
selects=root/'work'/'selects.ffconcat'
selects.write_text('ffconcat version 1.0\n'+'\n'.join("file '"+i['name']+"-select.mp4'" for i in items))
subprocess.run([ffmpeg,'-hide_banner','-loglevel','error','-y','-safe','0','-f','concat','-i',str(selects),'-c','copy','-movflags','+faststart',str(root/'YOLO-ui-selects.mp4')],check=True)
sheet=Image.new('RGB',(1600, len(range(0,len(items),3))*336),'#172720')
d=ImageDraw.Draw(sheet)
for n,item in enumerate(items):
    tile=Image.open(root/'stills'/f"{item['name']}.png").convert('RGB')
    tile=ImageOps.contain(tile,(512,288))
    x=16+(n%3)*528;y=16+(n//3)*336
    sheet.paste(tile,(x,y));d.text((x,y+296),item['name'].replace('-',' '),fill='#f2ecde')
sheet.save(root/'contact-sheet.jpg',quality=94)
cards=''.join(f'<article><h2>{html.escape(i["name"].replace("-"," "))}</h2><video controls preload="none" poster="stills/{i["name"]}.png" src="clips/{i["name"]}.mp4"></video><p>{i["duration"]:.1f}s · 1920 × 1080 · 30 fps · Silent source footage</p><a download href="clips/{i["name"]}.mp4">Download MP4</a></article>' for i in items)
(root/'index.html').write_text('''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>YOLO · Film selects</title><style>body{margin:0;background:#101d17;color:#f2ecde;font:16px system-ui}main{max-width:1200px;margin:auto;padding:48px 24px}h1{font-size:64px;letter-spacing:-3px;margin:0}header p{max-width:700px;line-height:1.6;color:#b8c9be}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(400px,1fr));gap:24px}article{background:#1c2c23;padding:20px;border-radius:16px}h2{font-size:18px}video{width:100%;border-radius:8px}a{color:#e7c75b}article p{font-size:13px;color:#b8c9be}.hero{margin:32px 0}.hero video{max-width:900px}</style><main><header><p>YOLO / PRODUCTION ASSETS</p><h1>nah, just YOLO.</h1><p>Real application recordings for the 100-second film. Individual clean clips, matching stills, and a quick selects reel. Demo trip: Ella Weekend. All people and transactions are sample data.</p><a href="contact-sheet.jpg">View contact sheet</a> · <a href="Ella-Weekend-report.pdf">Demo PDF report</a></header><section class="hero"><h2>Quick selects reel</h2><video controls preload="metadata" src="YOLO-ui-selects.mp4"></video></section><section class="grid">'''+cards+'</section></main></html>')
print('Verified all clips; gallery, contact sheet, and selects reel ready.',flush=True)
