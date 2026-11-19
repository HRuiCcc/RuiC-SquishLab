// 内置样品：一只可以捏的麻薯猫。没有外部图片依赖，离线也能玩。
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 900" width="900" height="900">
  <defs>
    <radialGradient id="body" cx="38%" cy="24%" r="80%">
      <stop offset="0" stop-color="#FFFDF6"/>
      <stop offset="0.55" stop-color="#FFEDD2"/>
      <stop offset="1" stop-color="#F4CEA4"/>
    </radialGradient>
    <radialGradient id="blush" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#FF8E79" stop-opacity="0.62"/>
      <stop offset="0.62" stop-color="#FF8E79" stop-opacity="0.34"/>
      <stop offset="1" stop-color="#FF8E79" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="shine" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.85"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="leaf" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#5F9C6C"/>
      <stop offset="1" stop-color="#8FC79B"/>
    </linearGradient>
    <filter id="soft" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="16"/>
    </filter>
  </defs>

  <ellipse cx="450" cy="806" rx="236" ry="30" fill="#2A1A12" opacity="0.1" filter="url(#soft)"/>

  <g>
    <path d="M244 304C236 224 258 160 300 141c44 28 72 92 78 158Z" fill="url(#body)"/>
    <path d="M270 282c-4-52 10-88 32-102 26 22 42 62 46 104Z" fill="#FFB6A6"/>
    <path d="M656 304c8-80-14-144-56-163-44 28-72 92-78 158Z" fill="url(#body)"/>
    <path d="M630 282c4-52-10-88-32-102-26 22-42 62-46 104Z" fill="#FFB6A6"/>
  </g>

  <path d="M450 200c170 0 292 130 292 300 0 172-126 286-292 286S158 672 158 500c0-170 122-300 292-300Z" fill="url(#body)"/>

  <g clip-path="none" opacity="0.5">
    <ellipse cx="450" cy="742" rx="270" ry="120" fill="#EFC094" opacity="0.5" filter="url(#soft)"/>
  </g>

  <g>
    <ellipse cx="338" cy="742" rx="58" ry="42" fill="#FFF6E4"/>
    <ellipse cx="562" cy="742" rx="58" ry="42" fill="#FFF6E4"/>
    <path d="M320 752q18 10 36 0" stroke="#E9BF95" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M544 752q18 10 36 0" stroke="#E9BF95" stroke-width="5" fill="none" stroke-linecap="round"/>
  </g>

  <ellipse cx="286" cy="540" rx="86" ry="56" fill="url(#blush)"/>
  <ellipse cx="614" cy="540" rx="86" ry="56" fill="url(#blush)"/>

  <g stroke="#3B2A23" stroke-width="13" fill="none" stroke-linecap="round">
    <path d="M310 470q40 -34 80 0"/>
    <path d="M510 470q40 -34 80 0"/>
  </g>

  <path d="M432 508h36l-18 20Z" fill="#E58A76" stroke="#E58A76" stroke-width="6" stroke-linejoin="round"/>
  <g stroke="#3B2A23" stroke-width="11" fill="none" stroke-linecap="round">
    <path d="M450 528q-8 26-32 18"/>
    <path d="M450 528q8 26 32 18"/>
  </g>

  <g>
    <path d="M450 214v-58" stroke="#5F9C6C" stroke-width="9" stroke-linecap="round"/>
    <path d="M450 174c-24-8-40-30-44-56 28-2 48 16 52 44Z" fill="url(#leaf)"/>
    <path d="M450 160c24-10 38-32 40-58-28 0-46 20-48 46Z" fill="url(#leaf)"/>
  </g>

  <ellipse cx="352" cy="340" rx="118" ry="76" fill="url(#shine)" transform="rotate(-18 352 340)"/>
  <ellipse cx="312" cy="356" rx="26" ry="15" fill="#FFFFFF" opacity="0.8" transform="rotate(-18 312 356)"/>
</svg>`;

export function sampleSVG() {
  return SVG;
}

export function sampleDataURL() {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG)}`;
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片载入失败'));
    img.src = src;
  });
}
