// ZIP (método "store", sem compressão) e XLSX mínimo (Office Open XML), sem dependências.

const enc = new TextEncoder();
let CRC_TABLE = null;

export function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** @param files [{name, data: string|Uint8Array}] → Uint8Array do .zip */
export function makeZip(files, date = new Date()) {
  const dosTime = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  const chunks = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
    ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

export function colName(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

/** Estilos de célula (índices de cellXfs). Uma célula pode ser um valor ou {v, s}. */
export const XS = Object.freeze({ normal: 0, header: 1, title: 2, section: 3, warn: 4, note: 5, good: 6 });

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="6"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FFC80500"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFC0302F"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF52514E"/><name val="Calibri"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF0F0EC"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF000000"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE4F4E4"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFC3C2B7"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="1" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>`;

function cellXml(raw, r, c, rowStyle) {
  const obj = raw !== null && typeof raw === 'object' && !(raw instanceof Date);
  const v = obj ? raw.v : raw, st = obj && raw.s != null ? raw.s : rowStyle;
  const ref = `${colName(c)}${r + 1}`, s = st ? ` s="${st}"` : '';
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
  if (v == null || v === '') return st ? `<c r="${ref}"${s}/>` : '';
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
}

/** sheet: {name, headers?, rows, widths?, freeze?, charts?}. Com headers, a linha 1 é o cabeçalho. */
function sheetXml(sheet, hasDrawing) {
  const all = sheet.headers ? [sheet.headers, ...sheet.rows] : sheet.rows;
  const ncol = Math.max(1, ...all.map((r) => r.length));
  const txt = (x) => String(x !== null && typeof x === 'object' ? x.v ?? '' : x ?? '');
  const widths = sheet.widths || Array.from({ length: ncol }, (_, j) => Math.min(48, Math.max(8, ...all.slice(0, 300).map((r) => (r[j] == null ? 0 : Math.min(60, txt(r[j]).length + 2))))));
  const body = all.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cellXml(v, i, j, sheet.headers && i === 0 ? XS.header : 0)).join('')}</row>`).join('');
  const freeze = sheet.freeze ?? !!sheet.headers;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0">${freeze ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : ''}</sheetView></sheetViews><cols>${widths.map((w, j) => `<col min="${j + 1}" max="${j + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${body}</sheetData>${hasDrawing ? '<drawing r:id="rId1"/>' : ''}</worksheet>`;
}

// ------------------------------------------------------------------ Gráficos nativos (DrawingML)
const C_NS = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const rich = (text, sz = 1200, b = 1) => `<c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}" b="${b}"/></a:pPr><a:r><a:rPr lang="pt-BR" sz="${sz}" b="${b}"/><a:t>${xmlEsc(text)}</a:t></a:r></a:p></c:rich></c:tx>`;
const absRef = (sheetName, col, r0, r1) => `'${sheetName.replace(/'/g, "''")}'!$${colName(col)}$${r0 + 1}:$${colName(col)}$${r1 + 1}`;
const numCache = (vals) => `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${vals.length}"/>${vals.map((v, i) => (Number.isFinite(v) ? `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>` : '')).join('')}</c:numCache>`;
const scaleXml = (rg) => (rg ? `<c:max val="${rg[1]}"/><c:min val="${rg[0]}"/>` : '');
const axis = (id, cross, pos, title, grid, rg = null) => `<c:valAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/>${scaleXml(rg)}</c:scaling><c:delete val="0"/><c:axPos val="${pos}"/>${grid ? '<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E1E0D9"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>' : ''}<c:title>${rich(title, 1000, 0)}<c:overlay val="0"/></c:title><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/><c:crossAx val="${cross}"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>`;

/**
 * chart: {title, xTitle, yTitle, lines, series:[{name, color, x:[col,r0,r1], y:[col,r0,r1], xs, ys}]}
 * As faixas são índices 0-based na planilha `sheetName` (já contando a linha de cabeçalho).
 */
/** Faixa do eixo X ajustada aos dados (o Excel começaria em 0). */
function dataRange(vals) {
  const v = vals.filter(Number.isFinite);
  if (!v.length) return null;
  let lo = Math.min(...v), hi = Math.max(...v);
  const pad = (hi - lo) * 0.04 || Math.abs(hi) * 0.05 || 1;
  lo -= pad; hi += pad;
  const raw = (hi - lo) / 5, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  return [+(Math.floor(lo / step) * step).toPrecision(10), +(Math.ceil(hi / step) * step).toPrecision(10)];
}

function chartXml(chart, sheetName) {
  const ser = chart.series.map((s, k) => {
    const col = (s.color || '2A78D6').replace('#', '').toUpperCase();
    const line = chart.lines !== false ? `<a:ln w="19050"><a:solidFill><a:srgbClr val="${col}"/></a:solidFill></a:ln>` : '<a:ln w="19050"><a:noFill/></a:ln>';
    return `<c:ser><c:idx val="${k}"/><c:order val="${k}"/><c:tx><c:v>${xmlEsc(s.name)}</c:v></c:tx><c:spPr>${line}</c:spPr><c:marker><c:symbol val="circle"/><c:size val="6"/><c:spPr><a:solidFill><a:srgbClr val="${col}"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:marker>`
      + `<c:xVal><c:numRef><c:f>${absRef(sheetName, ...s.x)}</c:f>${numCache(s.xs)}</c:numRef></c:xVal><c:yVal><c:numRef><c:f>${absRef(sheetName, ...s.y)}</c:f>${numCache(s.ys)}</c:numRef></c:yVal><c:smooth val="0"/></c:ser>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace ${C_NS}><c:roundedCorners val="0"/><c:chart><c:title>${rich(chart.title)}<c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${ser}<c:axId val="500001"/><c:axId val="500002"/></c:scatterChart>${axis(500001, 500002, 'b', chart.xTitle || 'x', false, dataRange(chart.series.flatMap((s) => s.xs)))}${axis(500002, 500001, 'l', chart.yTitle || 'y', true)}</c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
}

function drawingXml(charts, firstRid) {
  const anchors = charts.map((ch, k) => {
    const a = ch.anchor || { col: 0, row: 0, cols: 8, rows: 18 };
    return `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${a.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${a.col + a.cols}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.row + a.rows}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>`
      + `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${k + 2}" name="Grafico ${k + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId${firstRid + k}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors}</xdr:wsDr>`;
}

export const safeSheet = (s, i) => (String(s || `Planilha${i + 1}`).replace(/[[\]:*?/\\]/g, '_').slice(0, 31));

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const relsXml = (items) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('')}</Relationships>`;

/** @param sheets [{name, headers?, rows, widths?, freeze?, charts?}] → Uint8Array do .xlsx */
export function makeXlsx(sheets) {
  const names = sheets.map((s, i) => safeSheet(s.name, i));
  const files = [], overrides = [];
  let drawingNo = 0, chartNo = 0;
  sheets.forEach((s, i) => {
    const charts = s.charts || [];
    files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s, charts.length > 0) });
    overrides.push(`<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
    if (!charts.length) return;
    const d = ++drawingNo;
    files.push({ name: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`, data: relsXml([['rId1', 'drawing', `../drawings/drawing${d}.xml`]]) });
    files.push({ name: `xl/drawings/drawing${d}.xml`, data: drawingXml(charts, 1) });
    overrides.push(`<Override PartName="/xl/drawings/drawing${d}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
    const rels = [];
    charts.forEach((ch, k) => {
      const c = ++chartNo;
      files.push({ name: `xl/charts/chart${c}.xml`, data: chartXml(ch, names[i]) });
      overrides.push(`<Override PartName="/xl/charts/chart${c}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
      rels.push([`rId${k + 1}`, 'chart', `../charts/chart${c}.xml`]);
    });
    files.push({ name: `xl/drawings/_rels/drawing${d}.xml.rels`, data: relsXml(rels) });
  });
  const head = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides.join('')}</Types>` },
    { name: '_rels/.rels', data: relsXml([['rId1', 'officeDocument', 'xl/workbook.xml']]) },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}"><sheets>${names.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: relsXml([...names.map((_, i) => [`rId${i + 1}`, 'worksheet', `worksheets/sheet${i + 1}.xml`]), [`rId${names.length + 1}`, 'styles', 'styles.xml']]) },
    { name: 'xl/styles.xml', data: STYLES },
  ];
  return makeZip([...head, ...files]);
}

