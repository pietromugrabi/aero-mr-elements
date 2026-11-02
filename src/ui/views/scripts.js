import { h, card, numField, selectField, textField, checkField, msgs, copyText, toast, badge, download } from '../dom.js';
import * as store from '../store.js';
import { needs, pageHead } from '../common.js';
import { STAGES, DEFAULT_WB, wbSettings, allScripts, dpParamOptions, parseValues } from '../../core/wbscripts.js';

const HOWTO = {
  workbench: 'Workbench vazio → File > Scripting > Run Script File (ou cole na Command Window). Cria o sistema, aponta a peça e salva o .wbpj.',
  mesh: 'Grava o script do Mechanical na pasta do projeto, faz Reset da malha, abre o Mechanical (interativo) e envia o script. Depois do "OK" no log, rode a parte 2b.',
  fluent: 'Grava o journal Python na pasta do projeto, abre o Fluent e executa o setup. Depois do "FIM" no log, rode a parte 3b.',
  dps: 'Cria os design points variando um parâmetro, sem resolver. Rode depois que os parâmetros DS_ estiverem publicados.',
};

function block(label, text, file) {
  return h('div', { style: { marginTop: '10px' } },
    h('div', { class: 'row', style: { marginBottom: '6px' } },
      h('strong', null, label),
      h('button', { onclick: () => copyText(text).then((ok) => toast(ok === false ? 'Não foi possível copiar.' : 'Script copiado.', ok === false)) }, 'Copiar script'),
      file ? h('button', { onclick: () => download(file, text, 'text/x-python;charset=utf-8') }, 'Baixar .py') : null),
    h('pre', { class: 'out', style: { maxHeight: '320px', overflow: 'auto' } }, text));
}

export default function scripts(ctx) {
  const miss = needs(['project', 'pkg'], ctx); if (miss) return miss;
  const pkg = ctx.pkg, c = pkg.config;
  const w = () => { c.workbench = c.workbench || {}; return c.workbench; };
  const set = (fn, label, v) => store.update(() => fn(w()), ['scripts', pkg.name, label, v == null ? '' : String(v)]);
  const s = wbSettings(pkg), all = allScripts(pkg);
  const opts = dpParamOptions(pkg);
  const vals = parseValues(s.dp.values);

  const cfgCard = card('Caminhos e opções do Workbench',
    h('div', { class: 'fields' },
      textField({ label: 'Nome do sistema no Workbench', value: c.workbench?.systemName || '', placeholder: pkg.name, wide: true, onChange: (v) => set((o) => { o.systemName = v.trim(); }, 'nome do sistema', v) }),
      textField({ label: 'Peça do SolidWorks (.SLDPRT)', value: c.workbench?.geometryPath || '', placeholder: 'C:/fw_estudo/2D/Geometry/<cfg>/<cfg> 2025.SLDPRT', wide: true, onChange: (v) => set((o) => { o.geometryPath = v.trim(); }, 'peça', v) }),
      textField({ label: 'Projeto do Workbench (.wbpj)', value: c.workbench?.projectPath || '', placeholder: s.wbpj, wide: true, hint: `Scripts e logs vão para ${s.dir}/`, onChange: (v) => set((o) => { o.projectPath = v.trim(); }, 'projeto .wbpj', v) }),
      selectField({ label: 'Turbulência', value: c.workbench?.turb || '', options: [['', `automático pelo Fluent Setup (${s.turbResolved === 'geko' ? 'GEKO' : 'SST'})`], ['geko', 'k-ω GEKO'], ['sst', 'k-ω SST']], onChange: (v) => set((o) => { o.turb = v || null; }, 'turbulência', v) }),
      s.turbResolved === 'geko' ? numField({ label: 'GEKO Csep', unit: '—', value: c.workbench?.csep ?? null, placeholder: String(s.csepResolved).replace('.', ','), key: 'wb_csep', hint: 'Vazio = valor do texto do modelo de turbulência; padrão do Fluent = 1,75.', onChange: (v) => set((o) => { o.csep = v; }, 'Csep', v) }) : null,
      numField({ label: 'Intensidade turbulenta no inlet', unit: '%', value: s.turbIntensity, key: 'wb_ti', onChange: (v) => set((o) => { o.turbIntensity = v ?? DEFAULT_WB.turbIntensity; }, 'intensidade turbulenta', v) }),
      numField({ label: 'Razão de viscosidade turbulenta', unit: '—', value: s.viscRatio, key: 'wb_tvr', onChange: (v) => set((o) => { o.viscRatio = v ?? DEFAULT_WB.viscRatio; }, 'razão de viscosidade', v) }),
      numField({ label: 'Iterações (máximo)', unit: 'it.', value: s.iterations, key: 'wb_it', onChange: (v) => set((o) => { o.iterations = v == null ? DEFAULT_WB.iterations : Math.round(v); }, 'iterações', v) }),
      numField({ label: 'Convergência lift/drag: variação máx.', unit: '—', value: s.conv.stop, key: 'wb_cs', hint: 'Para quando lift_force e drag_force variam menos que isso (relativo) nas últimas iterações.', onChange: (v) => set((o) => { o.conv = { ...s.conv, ...(o.conv || {}), stop: v ?? DEFAULT_WB.conv.stop }; }, 'convergência: variação', v) }),
      numField({ label: 'Convergência: ignorar as primeiras', unit: 'it.', value: s.conv.ignore, key: 'wb_ci', onChange: (v) => set((o) => { o.conv = { ...s.conv, ...(o.conv || {}), ignore: v == null ? DEFAULT_WB.conv.ignore : Math.round(v) }; }, 'convergência: ignorar', v) }),
      numField({ label: 'Convergência: janela', unit: 'it.', value: s.conv.use, key: 'wb_cu', onChange: (v) => set((o) => { o.conv = { ...s.conv, ...(o.conv || {}), use: v == null ? DEFAULT_WB.conv.use : Math.max(1, Math.round(v)) }; }, 'convergência: janela', v) }),
      numField({ label: 'Critério dos resíduos', unit: '—', value: s.residual, key: 'wb_res', onChange: (v) => set((o) => { o.residual = v ?? DEFAULT_WB.residual; }, 'resíduos', v) }),
      numField({ label: 'Processos do Fluent', unit: 'proc.', value: s.processors, key: 'wb_np', onChange: (v) => set((o) => { o.processors = v == null ? DEFAULT_WB.processors : Math.max(1, Math.round(v)); }, 'processos', v) }),
      selectField({ label: 'Precisão do Fluent', value: s.precision, options: [['Double', 'Dupla'], ['Single', 'Simples']], onChange: (v) => set((o) => { o.precision = v; }, 'precisão', v) }),
      numField({ label: 'Esfera de influência da asa: raio', unit: '× C', value: s.wingSoi.radius, key: 'wb_soir', onChange: (v) => set((o) => { o.wingSoi = { ...s.wingSoi, ...(o.wingSoi || {}), radius: v ?? DEFAULT_WB.wingSoi.radius }; }, 'esfera da asa: raio', v) }),
      numField({ label: 'Esfera de influência da asa: tamanho', unit: 'mm', value: c.workbench?.wingSoi?.size ?? null, placeholder: 'C/200', key: 'wb_sois', onChange: (v) => set((o) => { o.wingSoi = { ...s.wingSoi, ...(o.wingSoi || {}), size: v }; }, 'esfera da asa: tamanho', v) })),
    h('div', { class: 'row', style: { marginTop: '8px', flexWrap: 'wrap', gap: '14px' } },
      checkField({ label: 'Esfera de influência na asa', checked: s.wingSoi.enabled, onChange: (v) => set((o) => { o.wingSoi = { ...s.wingSoi, ...(o.wingSoi || {}), enabled: v }; }, 'esfera da asa', v) }),
      checkField({ label: 'Edge sizing Hard', checked: s.edgeHard, onChange: (v) => set((o) => { o.edgeHard = v; }, 'edge sizing hard', v) }),
      checkField({ label: 'Gerar a malha no script', checked: s.generateMesh, onChange: (v) => set((o) => { o.generateMesh = v; }, 'gerar malha', v) }),
      checkField({ label: 'Parar por convergência de lift/drag', checked: s.conv.enabled, onChange: (v) => set((o) => { o.conv = { ...s.conv, ...(o.conv || {}), enabled: v }; }, 'convergência lift/drag', v) }),
      checkField({ label: 'Inicialização híbrida', checked: s.initHybrid, onChange: (v) => set((o) => { o.initHybrid = v; }, 'inicialização híbrida', v) }),
      checkField({ label: 'Resolver na parte 3b', checked: s.solve, onChange: (v) => set((o) => { o.solve = v; }, 'resolver', v) })),
    h('p', { class: 'muted' }, 'Tamanhos de malha, inflation, edge sizing, solo e esteira vêm da tela Mesh; Uinf, ρ, μ, valores de referência, vetores e nomes dos relatórios vêm do Fluent Setup; o modo 2D/3D vem da Geometria.'));

  const dpCard = h('div', { class: 'fields' },
    selectField({ label: 'Parâmetro a variar', value: opts.includes(s.dp.param) ? s.dp.param : '__outro', options: [...opts.map((o) => [o, o]), ['__outro', 'outro (digitar)']], onChange: (v) => { if (v !== '__outro') set((o) => { o.dp = { ...s.dp, ...(o.dp || {}), param: v }; }, 'DP: parâmetro', v); } }),
    textField({ label: 'Nome do parâmetro', value: s.dp.param, placeholder: 'ex.: DS_roll', onChange: (v) => set((o) => { o.dp = { ...s.dp, ...(o.dp || {}), param: v.trim() }; }, 'DP: parâmetro', v) }),
    textField({ label: 'Valores (separados por ";")', value: s.dp.values, placeholder: '0; 0,3; 0,6; 0,9; 1,2; 1,5', wide: true, hint: vals.length ? `${vals.length} valor(es): ${s.dp.applyDP0 ? 'o 1º vai para o DP 0, ' : ''}${Math.max(0, vals.length - (s.dp.applyDP0 ? 1 : 0))} DP novo(s).` : 'Na unidade do parâmetro no Workbench (DS_ de ângulo em graus, de comprimento em mm).', onChange: (v) => set((o) => { o.dp = { ...s.dp, ...(o.dp || {}), values: v }; }, 'DP: valores', v) }),
    h('div', { class: 'row', style: { gap: '14px', gridColumn: '1 / -1' } },
      checkField({ label: 'Aplicar o 1º valor ao DP 0', checked: s.dp.applyDP0, onChange: (v) => set((o) => { o.dp = { ...s.dp, ...(o.dp || {}), applyDP0: v }; }, 'DP: 1º valor no DP 0', v) }),
      checkField({ label: 'Retain (guardar os arquivos de cada DP)', checked: s.dp.retained, onChange: (v) => set((o) => { o.dp = { ...s.dp, ...(o.dp || {}), retained: v }; }, 'DP: retain', v) })));

  const stageCard = (st) => {
    const r = all[st.id];
    return card(`${st.n}) ${st.title}`,
      h('div', { class: 'row', style: { marginBottom: '6px' } }, st.tested ? badge('testado no VDI (Ansys 2025 R2)', 'ok') : badge('não testado', 'warn')),
      h('p', { class: 'muted' }, HOWTO[st.id]),
      st.id === 'dps' ? dpCard : null,
      msgs(r.issues),
      block('Script', r.text, r.file),
      r.finish ? block(`Parte ${st.n}b`, r.finish, null) : null);
  };

  return h('div', null,
    pageHead(`Scripts Workbench — ${pkg.name}`, 'Scripts IronPython gerados a partir deste pacote para copiar e colar no ANSYS Workbench (File > Scripting). O aplicativo não executa nada no ANSYS.', badge(s.mode, 'info')),
    msgs([{ level: 'info', msg: 'A Command Window corta linhas muito longas: prefira "Baixar .py" e File > Scripting > Run Script File. Os scripts 2 e 3 gravam os arquivos do Mechanical/Fluent na pasta do projeto antes de executá-los.' }]),
    cfgCard,
    STAGES.map(stageCard));
}
