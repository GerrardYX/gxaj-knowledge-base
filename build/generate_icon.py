#!/usr/bin/env python3
"""
gxaj知识库应用图标生成器 v2
设计理念：简洁扁平 + 大厂风格（参考腾讯/阿里）
"""
from PIL import Image, ImageDraw
import math

SIZE = 256

def create_icon_v2():
    """创建大厂风格图标"""
    img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 1. 纯色圆形背景（科技蓝）
    cx, cy = SIZE // 2, SIZE // 2
    r = 118
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], fill=(37, 99, 235))  # 腾讯蓝 #2563EB

    # 2. 白色书本轮廓（简洁线条）
    bw, bh = 90, 70
    book_top = cy - 25
    book_bottom = cy + 45
    book_left = cx - bw // 2
    book_right = cx + bw // 2

    # 左页（带折角）
    draw.polygon([
        (book_left, book_top + 8),
        (cx - 5, book_top),
        (cx - 5, book_bottom),
        (book_left, book_bottom - 5),
    ], fill=(255, 255, 255, 250))

    # 右页
    draw.polygon([
        (cx + 5, book_top),
        (book_right, book_top + 8),
        (book_right, book_bottom - 5),
        (cx + 5, book_bottom),
    ], fill=(245, 245, 245, 250))

    # 书脊（细线）
    draw.line([cx-5, book_top, cx-5, book_bottom], fill=(200, 200, 200, 255), width=2)

    # 3. 简洁的文字线（模拟文档内容）
    line_color = (180, 180, 180, 200)
    for i in range(3):
        y = book_top + 15 + i * 10
        draw.line([book_left + 12, y, cx - 15, y], fill=line_color, width=1)
        draw.line([cx + 15, y, book_right - 12, y], fill=line_color, width=1)

    # 4. AI标识：简洁的"问号"或"灯泡"圆点
    dot_r = 28
    dot_y = book_top - 18
    draw.ellipse([cx-dot_r, dot_y-dot_r, cx+dot_r, dot_y+dot_r], fill=(255, 255, 255))

    # 问号图形（简洁）
    q_color = (37, 99, 235)
    # 问号上半圆
    draw.arc([cx-12, dot_y-18, cx+12, dot_y+6], start=200, end=340, fill=q_color, width=4)
    # 问号下竖线
    draw.line([cx, dot_y+8, cx, dot_y+18], fill=q_color, width=4)
    # 问号底部点
    draw.ellipse([cx-3, dot_y+21, cx+3, dot_y+27], fill=q_color)

    return img

def create_icon_simple():
    """极简风格图标"""
    img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    cx, cy = SIZE // 2, SIZE // 2
    r = 118

    # 背景：渐变蓝（可选纯色）
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], fill=(59, 130, 246))

    # 简洁书本：两页 + 书脊
    margin = 30
    page_top = cy - 30
    page_bottom = cy + 35

    # 左页
    draw.polygon([
        (cx - margin - 25, page_top + 5),
        (cx - 4, page_top),
        (cx - 4, page_bottom),
        (cx - margin - 25, page_bottom),
    ], fill=(255, 255, 255))

    # 右页
    draw.polygon([
        (cx + 4, page_top),
        (cx + margin + 25, page_top + 5),
        (cx + margin + 25, page_bottom),
        (cx + 4, page_bottom),
    ], fill=(240, 240, 240))

    # 书脊
    draw.line([cx-4, page_top, cx-4, page_bottom], fill=(200, 200, 200), width=2)

    # 顶部：简洁"知识"符号 - 一个放大镜或问号
    symbol_r = 22
    symbol_y = page_top - 20
    draw.ellipse([cx-symbol_r, symbol_y-symbol_r, cx+symbol_r, symbol_y+symbol_r], fill=(255, 255, 255))

    # 放大镜手柄
    handle_x = cx + 12
    handle_y = symbol_y + 12
    draw.line([cx+10, symbol_y+10, handle_x, handle_y], fill=(255, 255, 255), width=4)

    # 放大镜镜片
    draw.ellipse([cx+6, symbol_y+6, cx+18, symbol_y+18], outline=(255, 255, 255), width=3)

    return img

def create_icon_tencent_style():
    """腾讯风格：蓝色圆形 + 简洁Q字母/知识符号"""
    img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    cx, cy = SIZE // 2, SIZE // 2
    r = 118

    # 背景：腾讯蓝
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], fill=(24, 119, 242))

    # 白色书本（更简洁）
    book_w = 80
    book_h = 60
    book_top = cy - 10
    book_bottom = book_top + book_h
    book_left = cx - book_w // 2

    # 左页
    draw.polygon([
        (book_left, book_top + 5),
        (cx - 3, book_top),
        (cx - 3, book_bottom),
        (book_left, book_bottom),
    ], fill=(255, 255, 255, 245))

    # 右页
    draw.polygon([
        (cx + 3, book_top),
        (book_left + book_w, book_top + 5),
        (book_left + book_w, book_bottom),
        (cx + 3, book_bottom),
    ], fill=(250, 250, 250, 245))

    # 书脊
    draw.line([cx-3, book_top, cx-3, book_bottom], fill=(220, 220, 220), width=2)

    # 顶部：简洁的问号气泡
    bubble_r = 24
    bubble_y = book_top - 28
    draw.ellipse([cx-bubble_r, bubble_y-bubble_r, cx+bubble_r, bubble_y+bubble_r], fill=(255, 255, 255))

    # 问号（简洁弧线）
    draw.arc([cx-10, bubble_y-12, cx+10, bubble_y+12], start=200, end=340, fill=(24, 119, 242), width=4)
    draw.line([cx, bubble_y+12, cx, bubble_y+18], fill=(24, 119, 242), width=4)
    draw.ellipse([cx-2, bubble_y+20, cx+2, bubble_y+24], fill=(24, 119, 242))

    return img

def create_icon_ali_style():
    """阿里风格：橙色主题"""
    img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    cx, cy = SIZE // 2, SIZE // 2
    r = 118

    # 背景：阿里橙
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], fill=(255, 106, 0))

    # 白色书本
    book_w = 85
    book_h = 65
    book_top = cy - 5
    book_bottom = book_top + book_h
    book_left = cx - book_w // 2

    # 左页
    draw.polygon([
        (book_left, book_top + 5),
        (cx - 3, book_top),
        (cx - 3, book_bottom),
        (book_left, book_bottom),
    ], fill=(255, 255, 255, 245))

    # 右页
    draw.polygon([
        (cx + 3, book_top),
        (book_left + book_w, book_top + 5),
        (book_left + book_w, book_bottom),
        (cx + 3, book_bottom),
    ], fill=(250, 250, 250, 245))

    # 书脊
    draw.line([cx-3, book_top, cx-3, book_bottom], fill=(220, 220, 220), width=2)

    # 顶部：简洁的"A"字母（阿里/AI）
    bubble_r = 24
    bubble_y = book_top - 28
    draw.ellipse([cx-bubble_r, bubble_y-bubble_r, cx+bubble_r, bubble_y+bubble_r], fill=(255, 255, 255))

    # 简洁A字母
    a_top = bubble_y - 10
    a_bottom = bubble_y + 10
    a_left = cx - 12
    a_right = cx + 12

    # A的左边
    draw.line([cx, a_top, a_left, a_bottom], fill=(255, 106, 0), width=3)
    # A的右边
    draw.line([cx, a_top, a_right, a_bottom], fill=(255, 106, 0), width=3)
    # A的横杠
    draw.line([a_left + 4, a_bottom - 8, a_right - 4, a_bottom - 8], fill=(255, 106, 0), width=3)

    return img

def create_icon_microsoft_style():
    """微软风格：多色块"""
    img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    cx, cy = SIZE // 2, SIZE // 2
    r = 118

    # 背景：浅灰
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], fill=(242, 242, 242))

    # 四个彩色方块（微软风格）
    block_size = 35
    colors = [
        (247, 99, 12),   # 橙
        (0, 120, 212),   # 蓝
        (136, 23, 152),  # 紫
        (0, 153, 188),   # 青
    ]

    positions = [
        (cx - block_size - 8, cy - block_size - 25),
        (cx + 8, cy - block_size - 25),
        (cx - block_size - 8, cy + 8),
        (cx + 8, cy + 8),
    ]

    for (px, py), color in zip(positions, colors):
        draw.rounded_rectangle([px, py, px+block_size, py+block_size], radius=6, fill=color)

    # 中间书本（白色）
    book_y = cy + 5
    book_w = 60
    book_h = 35
    draw.rounded_rectangle([cx-book_w//2, book_y, cx+book_w//2, book_y+book_h], radius=4, fill=(255, 255, 255))

    return img

def make_circle_with_shadow(img, padding=8):
    """为图标添加圆形裁剪和阴影"""
    # 创建输出图
    out_size = img.size[0] + padding * 2
    out = Image.new('RGBA', (out_size, out_size), (0, 0, 0, 0))
    out_draw = ImageDraw.Draw(out)

    # 添加阴影
    shadow_offset = 4
    for i in range(3, 0, -1):
        alpha = 20 - i * 5
        shadow_r = img.size[0] // 2 + padding + i
        out_draw.ellipse([
            out_size//2 - shadow_r,
            out_size//2 - shadow_r + shadow_offset,
            out_size//2 + shadow_r,
            out_size//2 + shadow_r + shadow_offset,
        ], fill=(0, 0, 0, alpha))

    # 粘贴主图标
    out.paste(img, (padding, padding), img)
    return out

def save_icon(icon, path, size=512):
    """保存图标"""
    resized = icon.resize((size, size), Image.LANCZOS)
    resized.save(path, 'PNG')
    print(f"✅ 已保存: {path}")

def save_ico(png_path, ico_path):
    """保存为ICO格式"""
    img = Image.open(png_path).convert('RGBA')
    sizes = [256, 128, 64, 48, 32, 16]
    imgs = [img.resize((s, s), Image.LANCZOS) for s in sizes]
    imgs[0].save(ico_path, format='ICO', sizes=[(s, s) for s in sizes])
    print(f"✅ ICO已保存: {ico_path}")

if __name__ == '__main__':
    out_dir = '/Users/gerrardyx/WorkBuddy/20260414144229/gxaj-knowledge-base/build'

    print("🎨 正在生成大厂风格图标...\n")

    # 生成各风格图标
    styles = [
        ("腾讯蓝风格", create_icon_tencent_style),
        ("阿里橙风格", create_icon_ali_style),
        ("微软多彩风格", create_icon_microsoft_style),
        ("极简风格", create_icon_simple),
        ("标准蓝色", create_icon_v2),
    ]

    all_icons = []
    for name, func in styles:
        print(f"生成: {name}")
        icon = func()
        all_icons.append((name, icon))

    # 保存单个最佳图标（腾讯蓝 - 最适合知识库）
    best_icon = all_icons[0][1]  # 腾讯蓝
    best_icon = make_circle_with_shadow(best_icon)

    # 512px PNG
    save_icon(best_icon, f'{out_dir}/icon_v2.png', 512)

    # ICO for Windows
    save_ico(f'{out_dir}/icon_v2.png', f'{out_dir}/icon.ico')

    # 生成对比预览图
    preview = Image.new('RGBA', (512 * len(all_icons), 270), (30, 30, 30, 255))
    label_y = 256

    for i, (name, icon) in enumerate(all_icons):
        icon_circle = make_circle_with_shadow(icon)
        icon_resized = icon_circle.resize((256, 256), Image.LANCZOS)

        # 添加标签
        label_draw = ImageDraw.Draw(preview)
        label_text = name
        x = 256 * i + 128 - 40
        label_draw.text((x, label_y + 5), label_text, fill=(200, 200, 200))

        preview.paste(icon_resized, (256 * i, 0), icon_resized)

    save_icon(preview, f'{out_dir}/icon_styles_preview.png', 512 * len(all_icons))

    print("\n🎉 完成！共生成5种风格：")
    for name, _ in all_icons:
        print(f"   • {name}")
