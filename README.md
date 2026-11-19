# 捏捏工坊 · SQUISH LAB

在照片上涂一块，只有这块会变成软糖。

**笔刷局部遮罩 · 弹簧网格物理 · 四档手感 · 四秒录成 GIF · 全程本地**

[在线试玩](https://hruiccc.github.io/RuiC-SquishLab/) · [源码](https://github.com/HRuiCcc/RuiC-SquishLab)

<div align="center">

![Vanilla JS](https://img.shields.io/badge/JavaScript-Vanilla-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![WebGL](https://img.shields.io/badge/WebGL-1.0-990000?style=flat-square&logo=webgl&logoColor=white)
![No backend](https://img.shields.io/badge/backend-none-2ea44f?style=flat-square)
![No build](https://img.shields.io/badge/build-none-8A2BE2?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

</div>

<div align="center">
  <img src="docs/demo.gif" alt="在照片上涂一块，切到捏一捏，按住拖动，四秒录成 GIF" width="820" />
  <br />
  <sub>涂腮帮子 → 捏它 → 四秒录成 GIF</sub>
</div>

## 🧸 这是什么

捏捏工坊是一个跑在浏览器里的照片捏捏工具：

1. 选一张照片，或者直接用内置的麻薯猫；
2. 用笔刷在照片上涂出想捏的地方；
3. 切到「捏一捏」，按住涂过的地方拖、戳、甩；
4. 录四秒，得到一张会回弹的 GIF；也能存一张透明底的 PNG。

它和「整张照片一起变形」不一样：**只有涂过的区域参与物理计算，没涂到的地方钉死不动**。所以你可以只让腮帮子鼓起来、只让肚子抖、只让枕头陷下去，眼睛和背景保持原样。

> 灵感来自 Saba no Games 的 [もちほっぺ・メーカー](https://sabanogames.com/entertainments/moti_hoppe_maker/)。
> 这个项目重新实现了笔刷遮罩、弹簧网格和浏览器内 GIF 编码，界面与交互是自己的设计：浅蓝糖果色、圆体字、圆润的按钮。

## 🎬 两种状态

| 涂一涂 | 捏一捏 |
| :---: | :---: |
| <img src="docs/paint.png" width="420" alt="涂一涂：粉色遮罩和笔刷工具条" /> | <img src="docs/preview.png" width="420" alt="捏一捏：按住涂过的地方拖动" /> |
| 粉色是涂过的区域，只有这里会动 | 按住、拖动、松手回弹，点一下是戳 |

## ✨ 功能

- 🖌️ **笔刷遮罩**：大小可调，柔边 / 硬边，橡皮、撤销、清空齐全
- 🫠 **真的会回弹**：顶点弹簧 + 邻居耦合，松手后自己抖两下
- 🎚️ **四档手感**：麻薯 / 果冻 / 棉花糖 / 橡皮，再加一根力度滑杆
- 🖐️ **多点触控**：鼠标、触屏、触控笔都能捏，几根手指同时上也行
- 🎞️ **四秒 GIF**：边捏边录，12fps，长边 440，自动加循环
- 🖼️ **透明 PNG**：当前画面直接裁成贴纸，能贴进聊天框
- 🔒 **全部本地**：没有后端、没有上传、没有统计；照片只在内存和 canvas 里
- ⌨️ **能用键盘**：B 涂、空格戳、R 复位、G 录制、P 存 PNG
- ♿ **照顾动效偏好**：`prefers-reduced-motion` 下关掉呼吸和过渡
- 🧩 **零依赖**：没有 npm 包、没有构建步骤，静态文件直接跑

## 🕹 怎么玩

1. **选照片**：点「选一张照片」，支持 JPG / PNG / WebP，动图取第一帧，也可以直接拖进来或 Ctrl+V 粘贴。
2. **涂一块**：在照片上刷出想捏的区域。涂得越大，回弹越夸张；没涂到的地方不会动。柔边适合腮帮子，硬边适合边界清楚的东西。
3. **捏一捏**：点「涂好了，去捏」。按住涂过的地方拖，松手回弹；不拖只点一下就是戳。四档手感管的是软硬和抖动。
4. **录下来**：点「开始录制 GIF」，四秒后自动停，等它压完，预览满意再点「保存」。

> 内置的麻薯猫已经预先涂好了两块腮帮子，打开就能先捏为敬。

## ⚙️ 工作原理

```mermaid
flowchart LR
  A[照片 / 内置麻薯猫] --> B[统一画到 Canvas<br/>最长边 1800]
  B --> C[WebGL 纹理]
  B --> D[三角网格<br/>每个顶点有 rest 坐标]
  E[笔刷 / 橡皮] --> F[遮罩画布<br/>最长边 960]
  F --> G[逐顶点双线性采样]
  G --> H{权重大于 0?}
  H -- 否 --> I[顶点钉死<br/>永远不动]
  H -- 是 --> J[弹簧 + 邻居耦合<br/>固定 60Hz 步长]
  J --> K[拖拽 / 戳的位移<br/>乘以权重]
  K --> L[WebGL 绘制]
  L --> M[抓四秒画面<br/>12fps]
  M --> N[gifenc 量化 + LZW]
  N --> O[预览 / 下载 GIF]
  L --> P[透明 PNG 快照]
```

**核心链路要点**

1. **遮罩就是权重**：笔刷画在一张独立的遮罩画布上，网格建好后逐顶点采样 alpha，得到 0 到 1 的权重。权重为 0 的顶点直接跳过物理循环，位置永远等于 rest 坐标。
2. **弹簧网格**：照片被切成约 50×50 的三角网格，每个顶点有 home 坐标、速度、邻居。回弹由 `k`、阻尼和邻居耦合三个参数控制，四档手感只是这三组数的组合。
3. **抓取锚点固定在按下的位置**：受力范围不跟手指跑，只把位移传给按下去那一片的顶点。这样从腮帮子拖到屏幕另一边，被拉的仍然是腮帮子，而不是拖出涂区就断掉。
4. **GIF 在本地压**：录制时直接 `drawImage` 抓 canvas 帧，用 [gifenc](https://github.com/mattdesl/gifenc) 做 256 色量化和 LZW，再拼成 Blob；服务器全程不参与。
5. **照片先归一化**：上传后统一画到 canvas 再上传纹理，避免 `ImageBitmap` 与普通图片在 WebGL 里翻转行为不一致，也顺手处理了超大图。

## 🎛 手感参数

| 手感 | 摸起来 | 弹簧刚度 | 阻尼 | 影响半径 |
| --- | --- | --- | --- | --- |
| 麻薯 | 慢慢回弹 | 0.15 | 0.90 | 26% |
| 果冻 | 抖得厉害 | 0.36 | 0.83 | 21% |
| 棉花糖 | 轻、很软 | 0.09 | 0.935 | 32% |
| 橡皮 | 紧、弹得快 | 0.55 | 0.79 | 17% |

## 🚀 本地运行

```bash
git clone https://github.com/HRuiCcc/RuiC-SquishLab.git
cd RuiC-SquishLab
python3 -m http.server 5173
```

打开 <http://localhost:5173>。

> 项目用了 ES Module，不能直接双击 `index.html`（`file://` 会被浏览器拦），需要起一个静态服务器。仓库没有构建步骤，也没有 npm 依赖。

## 🗂 目录结构

```text
RuiC-SquishLab/
├── index.html
├── css/
│   └── style.css
├── js/
│   ├── app.js        # 界面、模式切换、笔刷、上传、导出
│   ├── engine.js     # WebGL 网格、弹簧物理、遮罩权重
│   ├── recorder.js   # 抓帧、GIF 编码、PNG 快照
│   ├── sample.js     # 内置麻薯猫 SVG
│   └── audio.js      # 合成的捏捏声
├── assets/
│   ├── favicon.svg
│   ├── fonts/        # Gabarito（OFL）
│   └── wechat-donate.png
├── vendor/
│   └── gifenc.esm.js
├── docs/             # README 用的截图和演示
├── THIRD-PARTY.md
└── LICENSE
```

## ⌨️ 快捷键

| 按键 | 作用 |
| --- | --- |
| `B` | 切到「涂一涂」 |
| `空格` | 戳一下涂过的地方 |
| `R` | 复位形变 |
| `G` | 开始 / 停止录制 |
| `P` | 保存透明 PNG |

## 🔒 隐私

- 照片不会离开你的浏览器，没有上传接口。
- 页面加载完之后不需要网络也能继续用。
- GIF 和 PNG 都是本地生成，直接进下载文件夹。
- 没有埋点、没有账号、没有 cookie。

## 🧱 兼容性与已知限制

- 需要 WebGL 1.0；Chrome、Edge、Safari、Firefox 的现代版本都可以。
- 照片最长边会缩到 1800，遮罩最长边 960，够用但不适合印刷。
- GIF 固定四秒、12fps、长边 440。细节多的照片大概 2 到 4MB。
- 动图只取第一帧。
- iOS Safari 保存 Blob 下载时可能会先打开新标签页，长按保存即可。
- 手指也能涂，但要涂细一点还是用鼠标或触控笔。

## 🙏 致谢

- [gifenc](https://github.com/mattdesl/gifenc)：浏览器里的 GIF 量化与编码
- [Tabler Icons](https://github.com/tabler/tabler-icons)：界面线性图标
- [Gabarito](https://github.com/naipefoundry/gabarito)：拉丁字母与数字
- 灵感：[もちほっぺ・メーカー](https://sabanogames.com/entertainments/moti_hoppe_maker/) by Saba no Games

第三方许可证全文见 [THIRD-PARTY.md](THIRD-PARTY.md)。

## 📄 License

[MIT](LICENSE) © 2026 HRuiCcc

## 赞赏支持

<div align="center">
  <img src="assets/wechat-donate.png" width="300" alt="微信赞赏码" />
  <p>微信扫码赞赏</p>
</div>
