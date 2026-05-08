# gxaj知识库 - 打包图标说明

将应用图标文件放在此目录：

- `icon.ico` — Windows 安装包图标（推荐 256×256 ICO 格式）
- `icon.png` — 可选，用于 Linux/macOS 版本（256×256 PNG）

## 快速生成 ICO 文件

如果没有现成 ICO，可以：
1. 准备一张 256×256 的 PNG 图片（logo.png）
2. 使用在线工具 https://convertio.co/png-ico/ 转换
3. 重命名为 icon.ico 放到此目录

如果 build/icon.ico 文件不存在，打包命令会使用 Electron 默认图标。
