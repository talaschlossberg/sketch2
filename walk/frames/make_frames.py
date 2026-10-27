# Run from the repo root with the clip's frames extracted to a folder: python3 walk/frames/make_frames.py <frames folder> walk/frames
# Turn the frames of walk_cycle.mov into walk/frames/walk01.png ... :
# remove the loop jolt, bring out the detail in her dark clothes, crop and shrink.
import glob,sys
import numpy as np
from PIL import Image, ImageFilter
src,dst=sys.argv[1],sys.argv[2]
fs=sorted(glob.glob(src+'/*.png')); n=len(fs)
base=1012; height=base-336
bb=(332-18,336-14,733+6,1014+2)

def bleed(rgb, alpha):
    # fill the see-through background with her own nearby colours, so sharpening
    # doesn't see a black edge around her and leave a pale halo
    a=alpha[:,:,None]/255.0
    num=np.array(Image.fromarray(np.clip(rgb*a,0,255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(12))).astype(float)
    den=np.array(Image.fromarray((a[:,:,0]*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(12))).astype(float)[:,:,None]/255.0
    fill=num/np.maximum(den,1e-3)
    return rgb*a+fill*(1-a)

for i,f in enumerate(fs):
    t=i/(n-1)
    dx=-12*t                 # the head drifts forward ~12px over the clip; take it out bit by bit
    s=1+(6/height)*t         # and dips at the end; lift the upper body slightly, feet stay planted
    im=Image.open(f).convert('RGBA')
    im=im.transform(im.size,Image.AFFINE,(1,0,-dx,0,1/s,base-base/s),resample=Image.BICUBIC)
    a=np.array(im).astype(float)
    alpha=a[:,:,3]
    rgb=255*((a[:,:,:3]/255)**0.76)          # lift the shadows so the black clothes have detail
    rgb=bleed(rgb,alpha)
    pic=Image.fromarray(np.clip(rgb,0,255).astype(np.uint8))
    pic=pic.filter(ImageFilter.UnsharpMask(radius=14,percent=105,threshold=0))  # folds, pleats, the line of the shirt
    pic=pic.filter(ImageFilter.UnsharpMask(radius=2,percent=70,threshold=1))    # crisp edges
    out=pic.convert('RGBA'); out.putalpha(Image.fromarray(alpha.astype(np.uint8)))
    out=out.crop(bb); h=360; out=out.resize((round(out.width*h/out.height),h),Image.LANCZOS)
    out.save(dst+'/walk%02d.png'%(i+1),optimize=True)
