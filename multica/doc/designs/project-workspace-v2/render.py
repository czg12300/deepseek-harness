from __future__ import annotations
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from pathlib import Path
import math

OUT=Path(__file__).resolve().parent
OUT.mkdir(parents=True,exist_ok=True)
W,H,S=2048,1152,2
REG='/System/Library/AssetsV2/com_apple_MobileAsset_Font7/3419f2a427639ad8c8e139149a287865a90fa17e.asset/AssetData/PingFang.ttc'
BOLD='/System/Library/Fonts/STHeiti Medium.ttc'
C={'bg':'#FFFFFF','shell':'#F8F9FA','line':'#E5E7EA','text':'#15171A','muted':'#7F858D','soft':'#F4F5F6','dark':'#1C1D20','mid':'#C8CBD0','white':'#FFFFFF'}
F={}
def font(size,bold=False):
 key=(size,bold)
 if key not in F:F[key]=ImageFont.truetype(BOLD if bold else REG,size*S)
 return F[key]
def rr(d,box,fill,outline=None,r=12,width=1):
 box=tuple(int(v*S) for v in box)
 d.rounded_rectangle(box,radius=r*S,fill=fill,outline=outline,width=width*S)
def rect(d,box,fill):d.rectangle(tuple(int(v*S) for v in box),fill=fill)
def line(d,points,fill=C['line'],width=1):d.line([(int(x*S),int(y*S)) for x,y in points],fill=fill,width=width*S,joint='curve')
def ellipse(d,box,fill,outline=None,width=1):d.ellipse(tuple(int(v*S) for v in box),fill=fill,outline=outline,width=width*S)
def txt(d,x,y,s,size=16,fill=C['text'],bold=False,anchor=None):
 d.text((int(x*S),int(y*S)),s,font=font(size,bold),fill=fill,anchor=anchor,stroke_width=0)
def width(s,size=16,bold=False):return font(size,bold).getlength(s)/S
def wrap(d,x,y,s,maxw,size=16,fill=C['text'],leading=1.65,bold=False,maxlines=99):
 yy=y
 for paragraph in s.split('\n'):
  if not paragraph:yy+=size*leading;continue
  chunk=''; lines=[]
  for ch in paragraph:
   if width(chunk+ch,size,bold)>maxw and chunk:
    lines.append(chunk);chunk=ch
   else:chunk+=ch
  if chunk:lines.append(chunk)
  for item in lines[:maxlines]:
   txt(d,x,yy,item,size,fill,bold)
   yy+=size*leading
 return yy
def button(d,x,y,w,h,label,variant='outline',size=15):
 if variant=='solid':fill=C['dark'];stroke=C['dark'];fg='white'
 elif variant=='soft':fill=C['soft'];stroke=C['soft'];fg=C['text']
 elif variant=='disabled':fill='#F9F9FA';stroke='#EBECEE';fg='#BABDC2'
 else:fill='white';stroke=C['line'];fg=C['text']
 rr(d,(x,y,x+w,y+h),fill,stroke,9)
 txt(d,x+w/2,y+h/2,label,size,fg,variant=='solid',anchor='mm')
def play(d,x,y,color=C['dark'],r=14):
 d.polygon([(int((x-r*0.35)*S),int((y-r)*S)),(int((x+r)*S),int(y*S)),(int((x-r*0.35)*S),int((y+r)*S))],fill=color)

def badge(d,x,y,label,dark=False):
 w=max(52,width(label,12)+22)
 rr(d,(x,y,x+w,y+26),C['dark'] if dark else C['soft'],None,7)
 txt(d,x+w/2,y+13,label,12,'white' if dark else C['muted'],anchor='mm')
 return w

def base(title,stage,wide=False):
 im=Image.new('RGB',(W*S,H*S),C['bg']);d=ImageDraw.Draw(im)
 rect(d,(0,0,230,H),C['shell']);line(d,[(229,0),(229,H)])
 txt(d,22,26,'●  DSH 本地构建',18,C['text'],True)
 badge(d,21,57,'0.1.5 本地工作台')
 button(d,18,106,194,42,'＋  新会话',size=15)
 rr(d,(14,188,216,230),'#ECEEF1',None,7);txt(d,36,196,'▣  漫剧',17,C['text'],True)
 txt(d,24,270,'工作区',13,C['muted'])
 txt(d,24,305,'▤  WakaTv',15,C['muted'])
 txt(d,24,H-48,'⚙  设置',15,C['muted'])
 rect(d,(230,0,525,H),'white');line(d,[(524,0),(524,H)])
 txt(d,256,22,'漫剧工作台  /  全部项目',13,C['muted'])
 txt(d,256,52,'NBA：曼巴回来了',19,C['text'],True)
 txt(d,492,55,'⌄',20,C['muted'])
 line(d,[(230,94),(525,94)])
 if wide:
  rect(d,(525,0,W,H),'white')
 else:
  rect(d,(525,0,1440,H),'white');line(d,[(1439,0),(1439,H)])
  rect(d,(1440,0,W,H),'white')
 line(d,[(525,88),(W,88)])
 return im,d

def menu(d,active,locked=False):
 txt(d,256,118,'项目目录',13,C['muted'])
 def header(y,title,on,disabled=False,meta=''):
  if on:rr(d,(245,y-8,509,y+35),C['soft'],None,8)
  col=C['mid'] if disabled else C['text']
  txt(d,258,y,'▾' if on else '▸',17,col)
  txt(d,281,y,title,17,col,on)
  if disabled:txt(d,468,y+2,'锁定',11,C['mid'])
  elif meta:txt(d,474,y+2,meta,11,C['muted'])
 header(177,'剧本',active=='script',False,'04')
 items=[('故事大纲.md',225),('人物小传.md',268),('第01集剧本.md',311),('第02集剧本.md',354)]
 for label,y in items:
  if active=='script' and label=='故事大纲.md':rr(d,(280,y-5,504,y+33),'#ECEEF1',None,7)
  txt(d,291,y,'▤',16,C['muted'] if active!='script' else C['text'])
  txt(d,321,y,label,15,C['text'] if active=='script' and label=='故事大纲.md' else C['muted'])
 line(d,[(252,410),(500,410)])
 header(436,'制作',active=='production',locked)
 if locked:
  txt(d,283,477,'故事剧本定稿后解锁',12,C['mid'])
 else:
  if active=='production':
   for label,y in [('逐集制作',483),('第01集 · 序章',524),('第02集 · 真相',565),('整片制作',614),('MV · 回忆片段',655)]:
    if '第01集' in label:rr(d,(281,y-4,503,y+33),'#ECEEF1',None,7)
    txt(d,294,y,'◦' if '制作' in label else '▣',16,C['muted'])
    txt(d,320,y,label,14,C['text'] if '第01集' in label else C['muted'])
   button(d,279,701,213,37,'＋ 新建制作单位',size=13)
  else:txt(d,284,478,'2 个制作单位',12,C['muted'])
 line(d,[(252,761),(500,761)])
 header(789,'资产',active=='assets',locked)
 if locked:txt(d,283,830,'媒体能力未接入',12,C['mid'])
 else:
  for label,y in [('全部素材',835),('图片  ·  24',875),('视频  ·  08',915),('音频  ·  06',955)]:
   if active=='assets' and label=='全部素材':rr(d,(281,y-5,503,y+32),'#ECEEF1',None,7)
   txt(d,294,y,'◫',16,C['muted']);txt(d,321,y,label,14,C['text'] if active=='assets' and label=='全部素材' else C['muted'])
 line(d,[(252,H-101),(500,H-101)])
 txt(d,257,H-84,'当前阶段',12,C['muted'])
 txt(d,257,H-58,{'script':'剧本创作中','production':'制作进行中','assets':'项目资产已生成'}[active],14,C['text'],True)

def right_header(d,role,context):
 txt(d,1467,25,role,20,C['text'],True)
 badge(d,1912,26,'在线')
 txt(d,1467,56,context,12,C['muted'])
 line(d,[(1440,88),(W,88)])

def composer(d,x,y,w,h,placeholder,button_label='发送'):
 rr(d,(x,y,x+w,y+h),'white',C['line'],14)
 txt(d,x+18,y+17,placeholder,14,C['muted'])
 line(d,[(x+16,y+h-54),(x+w-16,y+h-54)])
 txt(d,x+19,y+h-40,'＋  添加参考',13,C['muted'])
 button(d,x+w-91,y+h-48,72,36,button_label,'solid',13)

def ai_script(d):
 right_header(d,'策划与编剧助手','正在编辑  /  故事大纲.md')
 rr(d,(1462,116,2021,213),C['soft'],None,10)
 txt(d,1482,134,'这一阶段的任务',15,C['text'],True)
 wrap(d,1482,163,'生成并整理 Markdown 文档；每个定稿产物自动出现在左侧「剧本」目录。',520,13,C['muted'])
 txt(d,1465,241,'工作记录',13,C['muted'])
 rr(d,(1604,274,2021,355),'#F4F5F6',None,12)
 wrap(d,1622,292,'根据构想写一版悬疑故事大纲，人物要有清晰动机。',370,14,C['text'])
 rr(d,(1464,382,2020,577),'white',C['line'],12)
 txt(d,1486,400,'AI 已完成初稿',15,C['text'],True)
 wrap(d,1486,432,'我整理了故事主线、人物关系、冲突与结局，并写入项目文档。',510,14,C['muted'])
 rr(d,(1482,501,2000,554),C['soft'],None,8)
 txt(d,1500,516,'▤  故事大纲.md',14,C['text'],True)
 txt(d,1887,518,'已写入',12,C['muted'])
 rr(d,(1464,601,2020,735),C['soft'],None,12)
 txt(d,1485,621,'下一步可以继续',14,C['text'],True)
 txt(d,1485,653,'生成「人物小传.md」',13,C['muted'])
 txt(d,1485,686,'按模板拆分第 01 / 02 集剧本',13,C['muted'])
 composer(d,1462,928,559,194,'描述要生成或修改的剧本文档…')

def script():
 im,d=base('剧本','script');menu(d,'script',True)
 txt(d,556,28,'剧本  /  故事大纲.md',14,C['muted']);badge(d,1337,28,'待定稿')
 rect(d,(525,88,1440,H),C['shell'])
 rr(d,(562,111,1404,1092),'white',C['line'],12)
 txt(d,611,145,'▤  Markdown 文档',13,C['muted'])
 txt(d,611,198,'故事大纲',30,C['text'],True)
 txt(d,611,247,'更新于 2026/09/24  ·  v3  ·  由策划助手生成',13,C['muted'])
 line(d,[(611,286),(1358,286)])
 txt(d,611,322,'创作起点',20,C['text'],True)
 wrap(d,611,361,'一名在海边城市长大的年轻调查员，因一卷失踪的胶片回到故乡。她发现每位失踪者都曾出现在同一部未完成的短片中。',700,16,C['text'],1.75)
 rr(d,(611,483,1362,566),C['soft'],None,6)
 wrap(d,632,496,'“每个人都记得那场首映，只有她不记得自己曾坐在第一排。”',696,16,C['text'],1.7)
 txt(d,611,611,'故事结构',20,C['text'],True)
 for y,no,title,desc in [(655,'01','回到海边','收到匿名胶片，主角重返停播十年的影院。'),(742,'02','记忆裂缝','她逐集追查胶片中的人，发现镜头曾记录自己。'),(829,'03','最后一幕','真相指向一次被集体改写的放映事故。')]:
  badge(d,611,y+1,no,True);txt(d,681,y,title,17,C['text'],True);txt(d,681,y+34,desc,14,C['muted'])
 line(d,[(611,938),(1358,938)])
 txt(d,611,965,'当前文档可浏览；生成建议需人工确认后成为定稿。',13,C['muted'])
 button(d,1157,1006,199,44,'查看 Markdown 原文',size=13)
 ai_script(d)
 return im

def canvas_nodes(d):
 # Full-width canvas; no persistent AI sidebar in production mode.
 rect(d,(525,88,W,H),'#F8F8F9')
 for y in range(116,1135,23):
  for x in range(546,2030,23):ellipse(d,(x,y,x+2,y+2),'#D7D9DC')
 txt(d,559,118,'第01集 · 序章  /  制作画布',18,C['text'],True)
 badge(d,1834,113,'无限画布')
 button(d,1929,110,78,37,'100%',size=12)
 # Connectors stay behind their nodes.
 for points in [
  [(864,358),(922,358),(922,402),(988,402)],
  [(1322,447),(1446,447),(1446,474),(1589,474)],
  [(893,732),(941,732),(941,590),(986,590)],
 ]:
  line(d,points,'#A8ADB3',3)
  for x,y in (points[0],points[-1]):ellipse(d,(x-5,y-5,x+5,y+5),'white','#8E9298',2)
 # Script input.
 rr(d,(589,248,865,486),'white',C['line'],12)
 badge(d,609,266,'文本')
 txt(d,610,308,'第01集剧本',17,C['text'],True)
 wrap(d,610,349,'主角抵达旧影院，空椅上放着一卷标着她名字的胶片。',226,13,C['muted'],1.55)
 txt(d,610,449,'已引用 v3',12,C['muted'])
 # Image node.
 rr(d,(987,280,1323,603),'white','#BDC0C5',13,2)
 rect(d,(1002,297,1308,529),'#E6E8EB')
 rect(d,(1020,315,1290,512),'#D3D6DA')
 rect(d,(1045,351,1110,512),'#777C83')
 rect(d,(1118,334,1191,512),'#8D9299')
 rect(d,(1200,369,1276,512),'#B0B4B9')
 ellipse(d,(1170,332,1224,386),'#D5D8DC')
 txt(d,1008,549,'旧影院 · 关键帧',15,C['text'],True)
 txt(d,1278,554,'v2',11,C['muted'])
 # Video output node.
 rr(d,(1588,332,1940,632),'white',C['line'],12)
 rect(d,(1604,348,1925,559),'#45484D')
 ellipse(d,(1739,432,1791,484),'white')
 play(d,1765,458,C['dark'],12)
 txt(d,1611,579,'开场镜头 · 视频',15,C['text'],True)
 txt(d,1864,600,'00:08',12,C['muted'])
 # Audio input node.
 rr(d,(590,641,894,844),'white',C['line'],12)
 badge(d,609,659,'音频')
 txt(d,610,702,'环境音 · 海风',15,C['text'],True)
 for i in range(29):
  xx=609+i*8;amp=13+18*abs(math.sin(i*0.8))
  line(d,[(xx,773-amp/2),(xx,773+amp/2)],'#858991',2)
 txt(d,610,812,'00:14',12,C['muted'])
 # Pan/zoom controls remain visible under the canvas.
 rr(d,(557,1057,708,1102),'white',C['line'],10)
 txt(d,577,1066,'−    100%    ＋',14,C['text'])

def production():
 im,d=base('制作','production',wide=True);menu(d,'production')
 txt(d,557,30,'制作  /  第01集 · 序章',14,C['muted'])
 badge(d,1951,29,'进行中')
 canvas_nodes(d)
 # Only AI control in this mode: a floating box inside the canvas.
 rr(d,(1374,827,2011,1105),'white','#AEB1B5',16,2)
 txt(d,1401,850,'✦  制作 AI',16,C['text'],True)
 txt(d,1923,854,'悬浮',12,C['muted'])
 wrap(d,1402,900,'把这段剧本变成三镜头分镜，先生成灰度关键帧。',554,15,C['text'])
 line(d,[(1400,972),(1984,972)])
 txt(d,1401,987,'＋ 参考    ▣ 选中节点    ▦ 逐集 / 整片模板',13,C['muted'])
 button(d,1910,1046,75,40,'生成','solid',13)
 return im

def thumbnail(d,x,y,w,h,kind,n):
 rr(d,(x,y,x+w,y+h),'#EFF0F2',None,11)
 if kind=='视频':
  rect(d,(x+10,y+10,x+w-10,y+h-10),'#44484E')
  for i in range(7):line(d,[(x+22+i*22,y+h-22),(x+33+i*22,y+26)],'#5E6269',2)
  ellipse(d,(x+w/2-24,y+h/2-24,x+w/2+24,y+h/2+24),'white')
  play(d,x+w/2,y+h/2,C['dark'],11)
 elif kind=='音频':
  for i in range(27):
   amp=(14+35*abs(math.sin(i*0.55+n*0.7)))
   xx=x+18+i*(w-36)/27
   line(d,[(xx,y+h/2-amp/2),(xx,y+h/2+amp/2)],'#666B73',3)
  ellipse(d,(x+w/2-23,y+h/2-23,x+w/2+23,y+h/2+23),'#FCFCFC','#D1D3D7')
  play(d,x+w/2,y+h/2,C['text'],9)
 else:
  # monochrome still image placeholder with filmic architecture/person
  rect(d,(x+9,y+9,x+w-9,y+h-9),'#DBDEE1')
  rect(d,(x+19,y+18,x+w-20,y+h-20),'#C4C8CD')
  for j in range(3):
   xx=x+33+j*70
   rect(d,(xx,y+45,xx+48,y+h-19),['#7B8087','#9BA0A7','#B5B8BE'][j])
  ellipse(d,(x+w-77,y+30,x+w-37,y+70),'#E8E9EA')
  rect(d,(x+w-79,y+75,x+w-35,y+h-21),'#6D727A')

def assets():
 im,d=base('资产','assets',wide=True);menu(d,'assets')
 txt(d,557,26,'项目资产',24,C['text'],True)
 txt(d,557,58,'制作过程中产生的图片、视频与音频文件',13,C['muted'])
 button(d,1930,25,83,39,'刷新',size=13)
 rect(d,(525,88,W,H),C['shell'])
 txt(d,556,112,'全部 38',14,C['text'],True)
 badge(d,653,108,'图片 24');badge(d,738,108,'视频 08');badge(d,823,108,'音频 06')
 rr(d,(1553,108,2011,150),'white',C['line'],8)
 txt(d,1570,117,'⌕  搜索文件名、标签或制作单位',13,C['muted'])
 cards=[
  ('图片','旧影院_关键帧_02.png','第01集 · 序章','v2'),('视频','开场镜头_03.mp4','第01集 · 序章','00:08'),
  ('图片','海边夜景_04.webp','MV · 回忆片段','v1'),('音频','海风环境音.wav','第01集 · 序章','00:14'),
  ('图片','胶片特写_01.png','第02集 · 真相','v1'),('视频','追逐镜头_05.mp4','第02集 · 真相','00:12'),
  ('音频','旁白_草稿.wav','MV · 回忆片段','00:23'),('图片','走廊人物_07.png','第01集 · 序章','v3'),
  ('图片','放映厅全景.png','第02集 · 真相','v1'),('图片','车窗倒影_09.png','第02集 · 真相','v1'),
  ('视频','收束镜头_08.mp4','MV · 回忆片段','00:10'),('音频','片尾音乐.wav','MV · 回忆片段','00:48'),
  ('图片','主角背影_12.png','第01集 · 序章','v2'),('视频','胶片转场_07.mp4','第02集 · 真相','00:05'),
  ('图片','海面日出_15.png','MV · 回忆片段','v1'),
 ]
 for i,(kind,name,unit,meta) in enumerate(cards):
  col=i%5;row=i//5;x=554+col*292;y=172+row*295
  rr(d,(x,y,x+275,y+276),'white',C['line'],10)
  thumbnail(d,x+10,y+10,255,174,kind,i)
  badge(d,x+17,y+17,kind,True)
  txt(d,x+15,y+195,name,13,C['text'],True)
  txt(d,x+15,y+222,unit,11,C['muted'])
  txt(d,x+236,y+222,meta,11,C['muted'])
 txt(d,558,1086,'点击素材可放大预览；图片支持查看原图，视频和音频可直接播放。',12,C['muted'])
 return im

def modal():
 im=assets();over=Image.new('RGBA',im.size,(19,20,23,170));im=Image.alpha_composite(im.convert('RGBA'),over)
 d=ImageDraw.Draw(im)
 rr(d,(277,78,1771,1074),'white',None,17)
 txt(d,313,106,'素材预览',19,C['text'],True)
 txt(d,313,144,'旧影院_关键帧_02.png   /   第01集 · 序章',13,C['muted'])
 button(d,1635,104,94,37,'✕  关闭',size=13)
 line(d,[(277,185),(1771,185)])
 rect(d,(307,217,1397,952),'#232527')
 # detailed image preview grayscale, architectural, deliberate not actual media
 rect(d,(338,247,1368,924),'#373A3D')
 rect(d,(376,302,1326,893),'#6C7075')
 for x,w in [(413,130),(577,170),(785,160),(1007,260)]:
  rect(d,(x,340,x+w,892),'#52565B')
  rect(d,(x+15,361,x+w-18,846),'#AAAEB3')
  for yy in [422,563,702]:line(d,[(x+15,yy),(x+w-18,yy)],'#686D73',4)
 rect(d,(685,680,856,892),'#282A2C')
 ellipse(d,(731,609,808,686),'#C2C4C7')
 txt(d,338,864,'图片原图预览  ·  2048 × 1152',13,'white')
 # right panel modal metadata
 line(d,[(1423,185),(1423,1074)])
 txt(d,1456,231,'文件信息',18,C['text'],True)
 for y,label,value in [(282,'类型','PNG 图片'),(345,'制作单位','第01集 · 序章'),(408,'来源节点','图片节点 2'),(471,'版本','v2'),(534,'分辨率','2048 × 1152')]:
  txt(d,1456,y,label,13,C['muted']);txt(d,1585,y,value,14,C['text'])
 line(d,[(1456,612),(1736,612)])
 txt(d,1456,642,'媒体查看方式',14,C['text'],True)
 txt(d,1456,684,'图片：查看原图 / 缩放',13,C['muted'])
 txt(d,1456,721,'视频：播放 / 暂停 / 进度',13,C['muted'])
 txt(d,1456,758,'音频：播放 / 暂停 / 进度',13,C['muted'])
 button(d,1456,959,136,44,'查看原图','solid',13)
 button(d,1607,959,130,44,'下载文件',size=13)
 return im.convert('RGB')

def media_player():
 im=assets();over=Image.new('RGBA',im.size,(19,20,23,170));im=Image.alpha_composite(im.convert('RGBA'),over)
 d=ImageDraw.Draw(im)
 rr(d,(277,78,1771,1074),'white',None,17)
 txt(d,313,106,'素材预览',19,C['text'],True)
 txt(d,313,144,'开场镜头_03.mp4   /   第01集 · 序章',13,C['muted'])
 button(d,1635,104,94,37,'✕  关闭',size=13)
 line(d,[(277,185),(1771,185)])
 rect(d,(307,217,1397,920),'#1C1D20')
 # video still: grayscale horizon, sea and theater facade
 rect(d,(351,254,1352,826),'#3E4146')
 rect(d,(351,560,1352,826),'#696D73')
 rect(d,(445,345,631,726),'#292C30')
 rect(d,(656,322,824,727),'#565B62')
 rect(d,(855,361,1137,727),'#303338')
 for xx in [476,542,690,750,910,1016]:
  rect(d,(xx,396,xx+38,500),'#A5A9AF')
 ellipse(d,(811,417,897,503),'#D5D7DA')
 rect(d,(812,500,901,728),'#222529')
 ellipse(d,(797,469,905,577),'white')
 play(d,854,524,C['dark'],24)
 # timeline and playback row
 line(d,[(336,861),(1366,861)],'#6E737B',5)
 line(d,[(336,861),(821,861)],'white',5)
 ellipse(d,(814,854,829,869),'white')
 txt(d,337,886,'⏸',18,'white')
 txt(d,385,889,'00:04 / 00:08',13,'white')
 txt(d,1208,889,'音量     ⛶',13,'white')
 txt(d,338,948,'视频在弹窗中直接播放；点击时间轴可定位，支持全屏。',13,C['muted'])
 line(d,[(1423,185),(1423,1074)])
 txt(d,1456,231,'播放与来源',18,C['text'],True)
 for y,label,value in [(282,'类型','MP4 视频'),(345,'制作单位','第01集 · 序章'),(408,'来源节点','视频节点 3'),(471,'时长','00:08'),(534,'分辨率','1920 × 1080')]:
  txt(d,1456,y,label,13,C['muted']);txt(d,1585,y,value,14,C['text'])
 line(d,[(1456,612),(1736,612)])
 txt(d,1456,642,'音频素材打开时',14,C['text'],True)
 wrap(d,1456,676,'沿用同一预览弹窗。中央视频区域切换为音频封面与波形，提供播放、暂停、进度和音量控制。',278,13,C['muted'])
 rr(d,(1456,798,1736,884),C['soft'],None,9)
 txt(d,1471,813,'海风环境音.wav',12,C['text'],True)
 for i in range(28):
  amp=9+17*abs(math.sin(i*0.55))
  xx=1475+i*8.6
  line(d,[(xx,854-amp/2),(xx,854+amp/2)],'#858990',2)
 button(d,1456,959,130,44,'在画布定位','solid',13)
 button(d,1602,959,134,44,'下载文件',size=13)
 return im.convert('RGB')

for name,fn in [('01-script',script),('02-production-canvas',production),('03-assets-grid',assets),('04-asset-preview',modal),('05-media-playback',media_player)]:
 image=fn().resize((W,H),Image.Resampling.LANCZOS)
 p=OUT/(name+'.png');image.save(p,optimize=True)
 print(str(p),image.size)

# Contact sheet for review; full-resolution files above remain the source designs.
thumb_w,thumb_h=960,540
overview=Image.new('RGB',(2048,1810),'#F4F5F6')
od=ImageDraw.Draw(overview)
for idx,(name,label) in enumerate([
 ('01-script','01 · 剧本与 Markdown'),('02-production-canvas','02 · 制作画布'),
 ('03-assets-grid','03 · 项目资产'),('04-asset-preview','04 · 图片原图预览'),
 ('05-media-playback','05 · 音视频播放预览'),
]):
 col,row=idx%2,idx//2
 x,y=35+col*1013,35+row*585
 od.text((x,y),label,font=ImageFont.truetype(BOLD,22),fill=C['text'])
 with Image.open(OUT/(name+'.png')) as page:
  overview.paste(page.resize((thumb_w,thumb_h),Image.Resampling.LANCZOS),(x,y+35))
overview.save(OUT/'00-overview.png',optimize=True)
print(str(OUT/'00-overview.png'),overview.size)
