(() => {
  const D = window.EDU, GJ = window.SUBURBS;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const root = document.documentElement;
  let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  root.setAttribute('data-theme', theme);

  const state = { ver: 'v2', alpha: 1, gender: 'all', ptype: 2, budget: 99, grade: 'all', selected: null, layers: { areas: true, private: true, gov: false, selective: true } };

  // ---------- helpers
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const short = n => n.replace('（天主教）', '').replace('（Keysborough/Brighton/City）', '').replace("Methodist Ladies' College", 'MLC').replace("Presbyterian Ladies' College", 'PLC').replace('Camberwell Girls Grammar School', 'CGGS').replace('Melbourne Girls Grammar', 'MGGS').replace('Melbourne Grammar School', 'Melbourne Grammar').replace(/ School$/, '').replace(/ College$/, '');
  const privByKey = {};
  D.schools.filter(s => s.kind === 'private').forEach(s => { privByKey[s.key] = privByKey[s.key] || s; });
  const genderOf = k => (privByKey[k] || {}).gender || '混校';
  const gradeOf = k => (privByKey[k] || {}).grade || '';
  const rest = a => a.eco + a.val + a.conv + a.rent + a.cat5;
  const score = a => {
    if (state.ver === 'v1') return a.total1;
    const wp = 10 + 25 * state.alpha, wg = 40 - 25 * state.alpha;
    return +(rest(a) + a.p35 / 35 * wp + a.gov15 / 15 * wg).toFixed(1);
  };
  const fits = a => { const p = a.entry[state.ptype]; return state.budget >= 99 || (p != null && p <= state.budget); };
  const schoolVisible = s => {
    if (s.kind !== 'private') return true;
    if (state.gender === 'boy' && s.gender === '女校') return false;
    if (state.gender === 'girl' && s.gender === '男校') return false;
    if (state.grade === 'S' && s.grade !== 'S') return false;
    if (state.grade === 'A+' && !(s.grade === 'S' || s.grade === 'A+')) return false;
    return true;
  };
  const ranked = () => {
    const arr = D.areas.map(a => ({ a, s: score(a) }));
    arr.sort((x, y) => y.s - x.s);
    arr.forEach((r, i) => r.rank = i + 1);
    return arr;
  };
  const colorFor = (s, min, max) => {
    const t = Math.max(0, Math.min(1, (s - min) / (max - min || 1)));
    const stops = [[242, 230, 201], [216, 178, 90], [111, 143, 168], [31, 58, 95]];
    const x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
    const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
    return `rgb(${c.join(',')})`;
  };

  // ---------- map
  const map = L.map('map', { zoomControl: false, attributionControl: true, preferCanvas: false, minZoom: 9, maxZoom: 18, zoomSnap: .5, zoomDelta: 1, wheelPxPerZoomLevel: 90, touchZoom: true, doubleClickZoom: true, scrollWheelZoom: true, boxZoom: true, bounceAtZoomLimits: false, maxBounds: [[-38.6, 144.2], [-37.3, 145.9]] }).setView([-37.86, 145.06], 11);
  const tileUrl = t => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${t === 'dark' ? 'World_Dark_Gray_Base' : 'World_Light_Gray_Base'}/MapServer/tile/{z}/{y}/{x}`;
  const tiles = L.tileLayer(tileUrl(theme), { maxZoom: 18, maxNativeZoom: 16, attribution: '底图 &copy; Esri · 学校坐标 &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · 边界 ABS SAL 2021' }).addTo(map);

  const suburbToArea = {};
  D.areas.forEach(a => a.members.forEach(m => suburbToArea[m] = a));
  const areaCentroid = {};
  const polyLayer = L.geoJSON(GJ, {
    filter: f => suburbToArea[f.properties.name],
    style: () => ({ weight: 1, color: '#ffffff', fillOpacity: .55 }),
    onEachFeature: (f, layer) => {
      const a = suburbToArea[f.properties.name];
      layer.on('click', () => selectArea(a.id, true));
      const b = layer.getBounds(), c = b.getCenter();
      (areaCentroid[a.id] = areaCentroid[a.id] || []).push(c);
      layer.bindTooltip(f.properties.name, { sticky: true, direction: 'top', opacity: .9 });
    }
  }).addTo(map);
  Object.keys(areaCentroid).forEach(k => {
    const cs = areaCentroid[k];
    areaCentroid[k] = L.latLng(cs.reduce((s, c) => s + c.lat, 0) / cs.length, cs.reduce((s, c) => s + c.lng, 0) / cs.length);
  });
  const pinLayer = L.layerGroup().addTo(map);
  const privLayer = L.layerGroup().addTo(map);
  const govLayer = L.layerGroup();
  const selLayer = L.layerGroup().addTo(map);
  const ringLayer = L.layerGroup().addTo(map);
  const focusLayer = L.layerGroup().addTo(map);
  const hav = (a, b) => { const R = 6371, r = x => x * Math.PI / 180, dl = r(b.lat - a.lat), dn = r(b.lng - a.lng); const h = Math.sin(dl / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  const govBase = n => n.replace(/（女校）/, '').replace(/ (Secondary College|High School|College|P-12 College)$/, '');
  const govSchools = D.schools.filter(s => s.kind === 'gov');
  const areaSchools = a => {
    const c = areaCentroid[a.id];
    const priv = a.near.map(([k, km]) => {
      const camps = D.schools.filter(s => s.kind === 'private' && s.key === k);
      if (!camps.length) return null;
      const s = camps.reduce((b, x) => hav(c, L.latLng(x.lat, x.lon)) < hav(c, L.latLng(b.lat, b.lon)) ? x : b);
      return { s, km };
    }).filter(Boolean);
    const gov = govSchools.filter(s => new RegExp(govBase(s.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "(?=\\s|'|（|；|$|SC|High|College)").test(a.gov))
      .map(s => ({ s, km: +hav(c, L.latLng(s.lat, s.lon)).toFixed(1) }));
    const sel = D.schools.filter(s => s.kind === 'selective').map(s => ({ s, km: +hav(c, L.latLng(s.lat, s.lon)).toFixed(1) })).sort((x, y) => x.km - y.km).slice(0, 2);
    return { priv, gov, sel };
  };
  let backArea = null;

  const gcls = g => g === 'S' ? 'g-S' : g === 'A+' ? 'g-A1' : 'g-A';
  const gch = g => g === '男校' ? '男' : g === '女校' ? '女' : '混';
  const privMarkers = [];
  D.schools.forEach(s => {
    if (s.kind === 'private') {
      const m = L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', html: `<div class="mk ${gcls(s.grade)}">${gch(s.gender)}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] }), keyboard: false, title: s.name, riseOnHover: true });
      m.on('click', () => showSchool(s));
      privMarkers.push({ s, m });
    } else if (s.kind === 'gov') {
      L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', html: `<div class="mk-gov">公</div>`, iconSize: [20, 20], iconAnchor: [10, 10] }), title: s.name }).on('click', () => showSchool(s)).addTo(govLayer);
    } else {
      L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', html: `<div class="mk-sel">选</div>`, iconSize: [28, 28], iconAnchor: [14, 14] }), title: s.name }).on('click', () => showSchool(s)).addTo(selLayer);
    }
  });

  const VN = { v1: '注重公立资源', v2: '注重私立资源' }, VS = { v1: '公立资源版', v2: '私立资源版' };
  const POS = a => state.ver === 'v1' ? a.pos1 : a.pos;
  function deltaTxt(a, rank) {
    const other = state.ver === 'v1' ? a.rank2 : a.rank1, lab = state.ver === 'v1' ? VS.v2 : VS.v1;
    const custom = state.ver === 'v2' && state.alpha !== 1;
    const base = custom ? a.rank2 : other, blab = custom ? VS.v2 + '标准' : lab;
    const d = base - rank;
    return `<span class="delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d === 0 ? '与' + blab + '同名次' : '较' + blab + (d > 0 ? '升 ' : '降 ') + Math.abs(d)}</span>`;
  }
  // ---------- render
  function render() {
    const R = ranked();
    const byId = {}; R.forEach(r => byId[r.a.id] = r);
    const min = Math.min(...R.map(r => r.s)), max = Math.max(...R.map(r => r.s));
    polyLayer.eachLayer(l => {
      const a = suburbToArea[l.feature.properties.name]; const r = byId[a.id]; const ok = fits(a);
      const sel = state.selected === a.id;
      l.setStyle({ fillColor: colorFor(R.length - r.rank, 0, R.length - 1), fillOpacity: state.layers.areas ? (ok ? (sel ? .8 : .58) : .12) : 0, color: sel ? '#c9962b' : (theme === 'dark' ? '#12161d' : '#ffffff'), weight: sel ? 3 : 1, opacity: state.layers.areas ? 1 : 0 });
      if (sel) l.bringToFront();
    });
    pinLayer.clearLayers();
    if (state.layers.areas) R.forEach(r => {
      const c = areaCentroid[r.a.id]; if (!c) return;
      const lbl = r.a.members[0];
      const z = map.getZoom(), showName = z >= 13 || state.selected === r.a.id || (z >= 12 && r.rank <= 6);
      const cls = ['area-pin', showName ? '' : 'mini', fits(r.a) ? '' : 'dim', state.selected === r.a.id ? 'sel' : ''].join(' ');
      L.marker(c, { icon: L.divIcon({ className: '', html: `<div class="${cls}"><b>${r.rank}</b>${showName ? esc(lbl) + (r.a.members.length > 1 ? ' 等' : '') : ''}</div>`, iconSize: null }), zIndexOffset: 1000 - r.rank + (state.selected === r.a.id ? 500 : 0), keyboard: false })
        .on('click', () => selectArea(r.a.id, true)).addTo(pinLayer);
    });
    privLayer.clearLayers();
    const selA = state.selected ? D.areas.find(x => x.id === state.selected) : null;
    const relKeys = selA ? new Set(selA.near.map(([k]) => k)) : null;
    if (state.layers.private) privMarkers.forEach(({ s, m }) => { if (schoolVisible(s) && !(relKeys && relKeys.has(s.key))) { m.setOpacity(relKeys ? .3 : 1); m.addTo(privLayer); } });
    drawFocus(selA);
    state.layers.gov ? govLayer.addTo(map) : govLayer.remove();
    state.layers.selective ? selLayer.addTo(map) : selLayer.remove();

    // list
    const list = $('#rankList');
    list.innerHTML = R.map(r => {
      const a = r.a, d = a.rank2 - r.rank;
      const near = a.near.filter(([k]) => schoolVisible(privByKey[k] || { kind: 'private', gender: genderOf(k), grade: gradeOf(k) })).slice(0, 3).map(([k, km]) => `${short(k)} ${km} km`).join('、');
      const e = a.entry[state.ptype];
      return `<li class="rank-item ${fits(a) ? '' : 'dim'}" data-id="${a.id}" tabindex="0">
        <div class="rank-no">${r.rank}</div>
        <div><div class="rank-name">${esc(a.name)}</div>
          <div class="rank-meta">${esc(near || '5 km 内无符合条件的私校')}</div>
          <div class="rank-meta">${esc(POS(a))} · 入场约 ${e != null ? 'A$' + e.toFixed(2) + 'M' : '数据不足'}</div>
          <div class="bar"><i style="width:${(state.ver === 'v1' ? a.gov25 / 25 : a.p35 / 35) * 100}%"></i></div></div>
        <div class="rank-score"><strong>${r.s}</strong>${deltaTxt(a, r.rank)}</div>
      </li>`;
    }).join('');
    $$('.rank-item', list).forEach(li => {
      const go = () => selectArea(+li.dataset.id, true);
      li.addEventListener('click', go); li.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    });
    const nFit = R.filter(r => fits(r.a)).length;
    const top = R.filter(r => fits(r.a)).slice(0, 3).map(r => r.a.members[0]).join('、');
    $('#summary').textContent = `${nFit} / ${R.length} 个区域符合当前筛选${top ? '，前三：' + top : ''}`;
    const wp = Math.round(10 + 25 * state.alpha), wg = 50 - wp;
    $('#wLabel').textContent = state.alpha === 1 ? `标准权重：私校距离 ${wp} · 公校 ${wg}` : `自定义：私校距离 ${wp} · 公校 ${wg}`;
    $('#weightBox').hidden = state.ver !== 'v2';
    $('#v1Note').hidden = state.ver !== 'v1';
    $$('.ver button').forEach(b => { b.classList.toggle('is-on', b.dataset.ver === state.ver); b.setAttribute('aria-pressed', b.dataset.ver === state.ver); });
    $('#subTitle').textContent = VN[state.ver] + ' · 2026-09-29';
    if (state.selected) renderDetail(state.selected, byId);
  }

  function drawFocus(a) {
    focusLayer.clearLayers();
    if (!a) return;
    const c = areaCentroid[a.id], S = areaSchools(a);
    const add = (it, cls, html, lab = true) => {
      L.polyline([c, [it.s.lat, it.s.lon]], { color: cls === 'gov' ? '#b5542d' : cls === 'sel' ? '#7a4fa3' : '#c9962b', weight: 2, opacity: .8, dashArray: '4 6', interactive: false }).addTo(focusLayer);
      L.marker([it.s.lat, it.s.lon], { icon: L.divIcon({ className: '', html: `<div class="focus ${cls}">${html}${lab ? `<span>${esc(short(it.s.name.replace('（女校）', '')))} · ${it.km} km</span>` : ''}</div>`, iconSize: null }), zIndexOffset: 2000 })
        .on('click', () => { backArea = a.id; showSchool(it.s, true); }).addTo(focusLayer);
    };
    S.priv.filter(it => schoolVisible(it.s)).forEach((it, i) => add(it, 'pri', `<i class="mk ${gcls(it.s.grade)}">${gch(it.s.gender)}</i>`, i < 3 || map.getZoom() >= 15));
    S.gov.forEach(it => add(it, 'gov', '<i class="mk-gov">公</i>'));
    S.sel.forEach((it, i) => add(it, 'sel', '<i class="mk-sel">选</i>', i === 0));
  }

  // ---------- detail: area
  function subRow(label, v, max, acc) {
    return `<div class="sub"><span>${label}</span><span class="track"><i class="${acc ? 'acc' : ''}" style="width:${(v / max * 100).toFixed(0)}%"></i></span><em>${v}/${max}</em></div>`;
  }
  function renderDetail(id, byId) {
    const a = D.areas.find(x => x.id === id), r = byId[id];
    const near = a.near.map(([k, km]) => {
      const vis = schoolVisible(privByKey[k] || { kind: 'private', gender: genderOf(k), grade: gradeOf(k) });
      return `<span class="chip ${vis ? '' : 'hide'}"><span class="dot ${gcls(gradeOf(k))}" style="width:16px;height:16px;font-size:9px">${gch(genderOf(k))}</span>${esc(short(k))}<i>${km} km</i></span>`;
    }).join('');
    $('#detail').innerHTML = `
      <div class="d-head"><div>
        <div class="d-kicker">${VN[state.ver]}第 ${r.rank}${state.ver === 'v2' && state.alpha !== 1 ? '（自定义权重）' : ''} · 注重公立资源第 ${a.rank1} · 注重私立资源第 ${a.rank2}</div>
        <h2 class="d-title">${esc(a.name)}</h2><span class="pos">${esc(POS(a))}</span></div>
        <button class="close" id="dClose" aria-label="关闭"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      </div>
      <div class="d-score">
        <div class="kpi"><span>${VN[state.ver]}得分</span><strong>${r.s}</strong></div>
        ${state.ver === 'v1' ? `<div class="kpi"><span>公校学区</span><strong>${a.gov25}</strong><span>/25</span></div>` : `<div class="kpi"><span>私校距离</span><strong>${a.p35}</strong><span>/35</span></div>`}
        <div class="kpi"><span>5 km 内私校</span><strong>${a.n5}</strong><span>其中 A+ 以上 ${a.top5}</span></div>
      </div>
      <div class="d-sec"><h4>区域内外的学校（点击查看）</h4>
        <p class="hint">地图已用虚线连到这些学校，距离为区域中心的直线距离。</p>
        <div class="slist">${(() => { const S = areaSchools(a); const row = (it, tag, cls) => `<button class="srow" data-k="${esc(it.s.name)}"><span class="stag ${cls}">${tag}</span><span class="sname">${esc(it.s.name)}</span><span class="skm">${it.km} km</span></button>`;
          return `<p class="sgrp">私立 / 天主教（需申请，住得近不算优先）</p>` + (S.priv.filter(it => schoolVisible(it.s)).map(it => row(it, it.s.grade + ' · ' + gch(it.s.gender), 'pri')).join('') || '<p class="hint">当前筛选下无</p>')
            + `<p class="sgrp">政府中学（常见学区对应，须门牌核验）</p>` + (S.gov.map(it => row(it, '公校 ' + (it.s.grade || ''), 'gov')).join('') || '<p class="hint">本区对应学校不在榜单内：' + esc(a.gov) + '</p>')
            + `<p class="sgrp">最近的选择性学校（考试入学，无学区）</p>` + S.sel.map(it => row(it, '选择性', 'sel')).join(''); })()}</div></div>
      <div class="d-sec"><h4>评分拆解（${VN[state.ver]}）</h4></div>
      ${state.ver === 'v1'
        ? subRow('政府中学学区', a.gov25, 25, true) + subRow('私校可达性', a.pri20, 20, true) + subRow('教育生态', a.eco, 10) + subRow('房产保值', a.val, 20) + subRow('生活通勤', a.conv, 10) + subRow('租赁', a.rent, 5) + subRow('催化剂与风险', a.cat10, 10)
        : subRow('质量加权距离', a.p_idx, 25, true) + subRow('男/女校覆盖', a.p_gender, 5, true) + subRow('最近 A+ 私校', a.p_near, 5, true) + subRow('政府中学学区', a.gov15, 15) + subRow('教育生态', a.eco, 10) + subRow('房产保值', a.val, 20) + subRow('生活通勤', a.conv, 10) + subRow('租赁', a.rent, 5) + subRow('催化剂与风险', a.cat5, 5)}
      <div class="d-sec"><h4>政府中学学区说明</h4><p>${esc(a.gov)}</p></div>
      <div class="d-sec"><h4>价格（2026 年 9 月）</h4>
        <div class="price"><div><b>House</b>${esc(a.house)}</div><div><b>Townhouse</b>${esc(a.th)}</div><div><b>Unit（2 房）</b>${esc(a.unit)}</div></div>
        <p style="margin-top:8px">${esc(a.trend)}；租金 ${esc(a.rentTxt)}</p></div>
      <div class="d-sec tri">
        <div><b>适合谁</b>${esc(a.fit)}</div><div><b>不适合谁</b>${esc(a.unfit)}</div><div><b>主要风险</b>${esc(a.risk)}</div>
      </div>
      <a class="btn solid" href="https://www.findmyschool.vic.gov.au/" target="_blank" rel="noopener">打开 Find my School 核验学区</a>
      <p class="warn">签约前必须使用官方 Find my School 按具体门牌地址和目标 enrolment year 核验。居住在学校附近仅改善通勤与教育生态，不构成录取保证；请按学校官网要求提前登记或申请。</p>`;
    $('#detail').hidden = false;
    $('#dClose').onclick = closeDetail;
    $$('.srow', $('#detail')).forEach(b => b.onclick = () => { const sc = D.schools.find(x => x.name === b.dataset.k); if (sc) { backArea = id; showSchool(sc, true); } });
  }
  function selectArea(id, fly) {
    state.selected = id; ringLayer.clearLayers();
    render();
    if (fly) {
      const layers = []; polyLayer.eachLayer(l => { if (suburbToArea[l.feature.properties.name].id === id) layers.push(l); });
      if (layers.length) {
        const b = L.featureGroup(layers).getBounds(); const aa = D.areas.find(x => x.id === id);
        areaSchools(aa).priv.filter(it => it.km <= 3.5).forEach(it => b.extend([it.s.lat, it.s.lon]));
        const mobile = innerWidth < 900;
        map.flyToBounds(b, { paddingTopLeft: [mobile ? 20 : 440, 20], paddingBottomRight: [mobile ? 20 : 440, mobile ? innerHeight * .55 : 20], maxZoom: 13, duration: .6 });
      }
    }
  }
  function closeDetail() { $('#detail').hidden = true; state.selected = null; ringLayer.clearLayers(); render(); }

  // ---------- detail: school
  function flyOffset(ll, z) {
    const mob = innerWidth < 900, p = map.project(L.latLng(ll), z).add([mob ? 0 : -0, mob ? innerHeight * .28 : 0]);
    map.flyTo(map.unproject(p, z), z, { duration: .5 });
  }
  function showSchool(s, fromArea) {
    if (!fromArea) backArea = null;
    state.selected = null; render(); ringLayer.clearLayers();
    let html = '';
    if (s.kind === 'private') {
      const ring = window.__rings = [3000, 5000];
      ring.forEach((r, i) => L.circle([s.lat, s.lon], { radius: r, color: '#c9962b', weight: i ? 1 : 2, dashArray: i ? '6 6' : null, fillOpacity: i ? 0 : .06 }).addTo(ringLayer));
      const inside = D.areas.filter(a => a.near.some(([k, km]) => k === s.key && km <= 5)).map(a => `${a.name}（${a.near.find(([k]) => k === s.key)[1]} km）`);
      html = `<div class="d-kicker">私立 / 天主教学校 · ${esc(s.gender)} · ${esc(s.grade)} 级${s.score ? ' · ' + s.score + ' 分' : ''}</div>
        <h2 class="d-title">${esc(s.name)}</h2>
        <div class="d-sec"><p>${esc(s.type)}｜${esc(s.loc)}</p><p>VCE 中位分 2022→2025：${esc(s.median)}</p><p>招生难度：${esc(s.diff)}</p><p>学费（2026，Y7–Y12）：${esc(s.fee)}</p><p>提示：${esc(s.note)}</p></div>
        <div class="d-sec"><h4>5 km 内的推荐区域</h4><p>${esc(inside.join('、') || '本报告区域均不在 5 km 内')}</p><p class="hint">地图上的实线圈为 3 km，虚线圈为 5 km（直线距离）。</p></div>
        <p class="warn">居住在学校附近仅改善通勤与教育生态，不构成录取保证；请按学校官网要求提前登记或申请。</p>`;
      flyOffset([s.lat, s.lon], 13);
    } else if (s.kind === 'gov') {
      flyOffset([s.lat, s.lon], 14);
      L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', html: `<div class="focus gov"><i class="mk-gov">公</i><span>${esc(s.name)}</span></div>`, iconSize: null }), zIndexOffset: 3000 }).addTo(ringLayer);
      html = `<div class="d-kicker">政府中学 · 榜单 A 第 ${s.rank} · ${esc(s.grade)} 级 · ${s.score} 分</div>
        <h2 class="d-title">${esc(s.name)}</h2>
        <div class="d-sec"><p>主要学区覆盖（常见对应）：${esc(s.zone)}</p><p>VCE 中位分 2022→2025：${esc(s.median)}；2025 年 40+ 比例 ${s.p40}%</p><p>趋势：${esc(s.trend)}｜学区稳定性：${esc(s.stability)}｜学区风险：${esc(s.risk)}</p><p>适合：${esc(s.fam)}</p></div>
        <a class="btn solid" href="https://www.findmyschool.vic.gov.au/" target="_blank" rel="noopener">在 Find my School 查看学区边界</a>
        <p class="warn">标记只表示学校位置，不代表学区边界。签约前必须使用官方 Find my School 按具体门牌地址和目标 enrolment year 核验。</p>`;
    } else {
      flyOffset([s.lat, s.lon], 14);
      L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', html: `<div class="focus sel"><i class="mk-sel">选</i><span>${esc(s.name)}</span></div>`, iconSize: null }), zIndexOffset: 3000 }).addTo(ringLayer);
      html = `<div class="d-kicker">选择性 / 特殊学校 · 没有学区</div>
        <h2 class="d-title">${esc(s.name)}</h2>
        <div class="d-sec"><p>${esc(s.note)}</p><p>四所选择性学校在 Year 8 统一考试招生，不按住址录取；John Monash Science School 为 Y10–12 自主选拔。住在附近只影响通勤。</p></div>
        <a class="btn" href="https://www.vic.gov.au/selective-entry-high-schools" target="_blank" rel="noopener">查看官方招生说明</a>`;
    }
    if (backArea) html = `<button class="back" id="dBack">← 返回 ${esc(D.areas.find(x => x.id === backArea).name)}</button>` + html;
    $('#detail').innerHTML = `<div class="d-head"><div>${html}</div><button class="close" id="dClose" aria-label="关闭"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>`;
    $('#detail').hidden = false; $('#dClose').onclick = closeDetail;
    if ($('#dBack')) $('#dBack').onclick = () => { const id = backArea; backArea = null; selectArea(id, true); };
  }

  // ---------- controls
  $$('.tab').forEach(t => t.addEventListener('click', () => {
    $$('.tab').forEach(x => { x.classList.toggle('is-on', x === t); x.setAttribute('aria-selected', x === t); });
    $$('.panel').forEach(p => p.classList.toggle('is-on', p.dataset.panel === t.dataset.tab));
    if ($('#sheet').dataset.state === 'peek') $('#sheet').dataset.state = 'half';
  }));
  $$('.seg').forEach(seg => seg.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    $$('button', seg).forEach(x => x.classList.toggle('is-on', x === b));
    const n = seg.dataset.name, v = b.dataset.v;
    state[n] = (n === 'budget' || n === 'ptype') ? +v : v;
    render();
  }));
  $$('.ver button').forEach(b => b.addEventListener('click', () => { state.ver = b.dataset.ver; state.layers.gov = state.ver === 'v1'; $('#layerPop input[data-layer=gov]').checked = state.layers.gov; render(); }));
  $('#alpha').addEventListener('input', e => { state.alpha = +e.target.value / 100; render(); });
  $('#btnLayers').addEventListener('click', () => { const p = $('#layerPop'); p.hidden = !p.hidden; });
  $$('#layerPop input').forEach(i => i.addEventListener('change', () => { state.layers[i.dataset.layer] = i.checked; render(); }));
  map.on('click', () => { $('#layerPop').hidden = true; });
  $('#btnTheme').addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark'; root.setAttribute('data-theme', theme); tiles.setUrl(tileUrl(theme)); render();
  });

  // sheet drag / tap
  const sheet = $('#sheet'), grab = $('#grab'), order = ['peek', 'half', 'full'];
  let y0 = null;
  grab.addEventListener('click', () => { if (grab.dataset.skip) { delete grab.dataset.skip; return; } const i = order.indexOf(sheet.dataset.state); sheet.dataset.state = order[(i + 1) % 3]; });
  grab.addEventListener('pointerdown', e => { y0 = e.clientY; grab.setPointerCapture(e.pointerId); });
  grab.addEventListener('pointerup', e => {
    if (y0 == null) return; const dy = e.clientY - y0; y0 = null;
    if (Math.abs(dy) < 20) return;
    grab.dataset.skip = '1';
    const i = order.indexOf(sheet.dataset.state);
    sheet.dataset.state = order[Math.max(0, Math.min(2, i + (dy < 0 ? 1 : -1)))];
    e.preventDefault();
  });

  const ZC = L.Control.extend({ options: { position: 'topright' }, onAdd() {
    const d = L.DomUtil.create('div', 'zc');
    d.innerHTML = `<button data-z="in" aria-label="放大">+</button><button data-z="out" aria-label="缩小">−</button><button data-z="all" aria-label="显示全部区域" title="显示全部区域"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button><span class="zl" aria-live="polite"></span>`;
    L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d);
    d.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.z === 'in') map.zoomIn(); else if (b.dataset.z === 'out') map.zoomOut();
      else map.flyToBounds(polyLayer.getBounds(), { paddingTopLeft: [innerWidth < 900 ? 10 : 420, 10], paddingBottomRight: [10, innerWidth < 900 ? 200 : 10], duration: .6 }); });
    const upd = () => { d.querySelector('.zl').textContent = 'Z' + map.getZoom().toFixed(1).replace('.0', ''); d.querySelector('[data-z=in]').disabled = map.getZoom() >= map.getMaxZoom(); d.querySelector('[data-z=out]').disabled = map.getZoom() <= map.getMinZoom(); };
    map.on('zoomend', upd); setTimeout(upd); return d;
  } });
  new ZC().addTo(map);
  const mob = innerWidth < 900;
  map.setView(mob ? [-37.855, 145.06] : [-37.86, 145.02], mob ? 12 : 12);
  map.on('zoomend', () => { document.body.classList.toggle('z-low', map.getZoom() < 13); render(); });
  document.body.classList.toggle('z-low', map.getZoom() < 13);
  render();
})();
