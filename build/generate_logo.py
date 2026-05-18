#!/usr/bin/env python3
"""
漫威动漫风 Logo 生成器
风格：红蓝撞色 + 漫画粗线条 + 闪电/星星 + 力量感
"""
from PIL import Image, ImageDraw, ImageFont
import math

SIZE = 128

def create_marvel_logo():
    """创建漫威动漫风格 logo"""
    img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    cx, cy = SIZE // 2, SIZE // 2

    # 1. 红色圆形背景（漫威红）
    r = 56
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], fill=(230, 30, 30))

    # 2. 蓝色内环（漫威蓝）
    inner_r = 44
    draw.ellipse([cx-inner_r, cy-inner_r, cx+inner_r, cy+inner_r], fill=(30, 60, 230))

    # 3. 白色闪电符号（代表知识/能量）
    lightning_color = (255, 220, 0)  # 金黄色

    # 主闪电
    lightning_pts = [
        (cx + 15, cy - 35),   # 顶部右
        (cx + 5, cy - 5),     # 中间左
        (cx + 15, cy - 5),    # 中间右
        (cx - 15, cy + 35),   # 底部左
        (cx - 5, cy + 5),     # 中间右
        (cx - 15, cy + 5),    # 中间左
    ]
    draw.polygon(lightning_pts, fill=lightning_color)

    # 4. 漫画风格白色边框线
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], outline=(255, 255, 255), width=3)

    # 5. 漫画效果线（四周放射线）
    line_color = (255, 255, 255, 180)
    for i in range(8):
        angle = math.pi / 4 * i
        x1 = cx + int(r * 0.85 * math.cos(angle))
        y1 = cy + int(r * 0.85 * math.sin(angle))
        x2 = cx + int(r * 1.05 * math.cos(angle))
        y2 = cy + int(r * 1.05 * math.sin(angle))
        draw.line([x1, y1, x2, y2], fill=line_color, width=2)

    # 6. 星星点缀
    star_color = (255, 220, 0)
    stars = [(35, 35), (93, 35), (35, 93), (93, 93)]
    for sx, sy in stars:
        draw_star(draw, sx, sy, 5, 2, star_color)

    return img

def draw_star(draw, cx, cy, outer_r, inner_r, color):
    """绘制五角星"""
    points = []
    for i in range(10):
        angle = math.pi / 2 + math.pi * i / 5
        r = outer_r if i % 2 == 0 else inner_r
        x = cx + int(r * math.cos(angle))
        y = cy - int(r * math.sin(angle))
        points.append((x, y))
    draw.polygon(points, fill=color)

def create_marvel_shield():
    """漫威盾牌风格 logo"""
    img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    cx, cy = SIZE // 2, SIZE // 2

    # 盾牌形状
    shield_pts = [
        (cx, cy - 50),    # 顶部
        (cx + 45, cy - 30),  # 右上
        (cx + 45, cy + 10),  # 右下
        (cx, cy + 50),   # 底部
        (cx - 45, cy + 10),  # 左下
        (cx - 45, cy - 30),  # 左上
    ]

    # 盾牌背景（红蓝撞色）
    # 下半蓝
    draw.polygon([
        (cx, cy), (cx + 45, cy + 10), (cx, cy + 50),
        (cx - 45, cy + 10)
    ], fill=(30, 60, 230))
    # 上半红
    draw.polygon([
        (cx, cy - 50), (cx + 45, cy - 30), (cx, cy),
        (cx - 45, cy - 30)
    ], fill=(230, 30, 30))

    # 盾牌边框
    draw.polygon(shield_pts, outline=(255, 255, 255), width=3)

    # 中心问号（代表知识）
    q_color = (255, 255, 255)
    draw.arc([cx-15, cy-18, cx+15, cy+18], start=200, end=340, fill=q_color, width=5)
    draw.line([cx, cy+18, cx, cy+25], fill=q_color, width=5)
    draw.ellipse([cx-4, cy+28, cx+4, cy+34], fill=q_color)

    return img

def create_comic_style():
    """漫画网点风格 logo"""
    img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    cx, cy = SIZE // 2, SIZE // 2

    # 红色圆形
    r = 54
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], fill=(230, 30, 30))

    # 蓝色内圆
    inner_r = 40
    draw.ellipse([cx-inner_r, cy-inner_r, cx+inner_r, cy+inner_r], fill=(30, 60, 230))

    # 白色书本（简洁线条）
    bw, bh = 50, 38
    book_top = cy - 12
    book_left = cx - bw // 2

    # 左页
    draw.polygon([
        (book_left, book_top + 4),
        (cx - 3, book_top),
        (cx - 3, book_top + bh),
        (book_left, book_top + bh - 4),
    ], fill=(255, 255, 255))

    # 右页
    draw.polygon([
        (cx + 3, book_top),
        (book_left + bw, book_top + 4),
        (book_left + bw, book_top + bh - 4),
        (cx + 3, book_top + bh),
    ], fill=(245, 245, 245))

    # 书脊
    draw.line([cx-3, book_top, cx-3, book_top+bh], fill=(180, 180, 180), width=2)

    # 漫画网点效果（四个角落）
    dot_positions = [
        (cx - 35, cy - 35),
        (cx + 35, cy - 35),
        (cx - 35, cy + 35),
        (cx + 35, cy + 35),
    ]
    for px, py in dot_positions:
        draw.ellipse([px-3, py-3, px+3, py+3], fill=(255, 220, 0))

    # 漫画风格粗边框
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], outline=(255, 255, 255), width=4)

    return img

def create_ironman_style():
    """钢铁侠风格 logo"""
    img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    cx, cy = SIZE // 2, SIZE // 2

    # 圆形反应堆底座（金色）
    r = 54
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], fill=(218, 165, 32))  # 金色

    # 内圈（蓝色能量）
    inner_r = 42
    draw.ellipse([cx-inner_r, cy-inner_r, cx+inner_r, cy+inner_r], fill=(30, 60, 230))

    # 能量核心（白色三角）
    triangle_pts = [
        (cx, cy - 28),     # 顶部
        (cx - 24, cy + 20),  # 左下
        (cx + 24, cy + 20),  # 右下
    ]
    draw.polygon(triangle_pts, fill=(255, 255, 255))

    # 能量环
    ring_r = 35
    draw.ellipse([cx-ring_r, cy-ring_r, cx+ring_r, cy+ring_r],
                  outline=(255, 220, 0), width=3)

    # 中心点
    draw.ellipse([cx-6, cy-6, cx+6, cy+6], fill=(255, 100, 0))  # 橙色核心

    return img

def create_spider_style():
    """蜘蛛侠风格 logo"""
    img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    cx, cy = SIZE // 2, SIZE // 2

    # 红色圆形
    r = 54
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], fill=(200, 30, 30))

    # 蓝色蜘蛛网背景
    web_color = (30, 60, 230, 80)
    for i in range(1, 5):
        rr = inner_r = r * i // 5
        draw.ellipse([cx-rr, cy-rr, cx+rr, cy+rr],
                      outline=(30, 60, 230, 150), width=1)

    # 中心书本图标
    bw, bh = 36, 28
    book_top = cy - 5
    book_left = cx - bw // 2

    draw.polygon([
        (book_left, book_top + 3),
        (cx - 2, book_top),
        (cx - 2, book_top + bh),
        (book_left, book_top + bh - 3),
    ], fill=(255, 255, 255))

    draw.polygon([
        (cx + 2, book_top),
        (book_left + bw, book_top + 3),
        (book_left + bw, book_top + bh - 3),
        (cx + 2, book_top + bh),
    ], fill=(240, 240, 240))

    # 白色边框
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], outline=(255, 255, 255), width=3)

    return img

def make_circle_icon(img, padding=6):
    """添加圆形裁剪"""
    out_size = img.size[0] + padding * 2
    out = Image.new('RGBA', (out_size, out_size), (0, 0, 0, 0))

    # 阴影
    shadow = Image.new('RGBA', (out_size, out_size), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    for i in range(4, 0, -1):
        shadow_draw.ellipse([
            out_size//2 - img.size[0]//2 - i,
            out_size//2 - img.size[0]//2 - i + 3,
            out_size//2 + img.size[0]//2 + i,
            out_size//2 + img.size[0]//2 + i + 3,
        ], fill=(0, 0, 0, 20 * (5-i)))

    out = Image.alpha_composite(out, shadow)
    out.paste(img, (padding, padding), img)
    return out

def save_icon(icon, path, size=128):
    """保存图标"""
    resized = icon.resize((size, size), Image.LANCZOS)
    resized.save(path, 'PNG')
    print(f"✅ {path}")

def save_ico(png_path, ico_path):
    """保存ICO"""
    img = Image.open(png_path).convert('RGBA')
    sizes = [256, 128, 64, 48, 32, 16]
    imgs = [img.resize((s, s), Image.LANCZOS) for s in sizes]
    imgs[0].save(ico_path, format='ICO', sizes=[(s, s) for s in sizes])
    print(f"✅ {ico_path}")

if __name__ == '__main__':
    out_dir = '/Users/gerrardyx/WorkBuddy/20260414144229/gxaj-knowledge-base/build'

    print("🎨 生成漫威动漫风 Logo...\n")

    styles = [
        ("闪电能量", create_marvel_logo),
        ("经典盾牌", create_marvel_shield),
        ("漫画网点", create_comic_style),
        ("钢铁侠反应堆", create_ironman_style),
        ("蜘蛛侠红蓝", create_spider_style),
    ]

    all_icons = []
    for name, func in styles:
        print(f"生成: {name}")
        icon = make_circle_icon(func())
        all_icons.append((name, icon))

    # 保存主图标（闪电能量风格）
    main_icon = all_icons[0][1]
    save_icon(main_icon, f'{out_dir}/logo_marvel.png', 256)
    save_ico(f'{out_dir}/logo_marvel.png', f'{out_dir}/logo.ico')

    # 生成预览对比图
    preview = Image.new('RGBA', (128 * len(all_icons), 180), (30, 30, 30, 255))
    label_y = 140

    for i, (name, icon) in enumerate(all_icons):
        icon_resized = icon.resize((100, 100), Image.LANCZOS)
        preview.paste(icon_resized, (128 * i + 14, 20), icon_resized)

        # 标签
        label_draw = ImageDraw.Draw(preview)
        label_draw.text((128 * i + 50 - len(name) * 3, label_y), name, fill=(200, 200, 200))

    save_icon(preview, f'{out_dir}/logo_marvel_preview.png',
              128 * len(all_icons))

    print(f"\n🎉 完成！5种漫威风格 Logo")
