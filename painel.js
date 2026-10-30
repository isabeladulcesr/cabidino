/* =====================================================================
   PAINEL DA CABIDINO
   Só é carregado para quem administra a loja (dono ou editor do site).
   - Catálogo (produtos, estoque, promoções, cupons, afiliados, textos):
     é editado num rascunho e vai ao ar no botão "Publicar no site".
   - Dados particulares (pedidos e comissões de afiliados): ficam no
     banco do site, que só administradores conseguem ler.
   ===================================================================== */
(function () {
  if (window.PainelCabidino) return;
  const S = window.CABIDINO_SITE, ORIGINAL = window.CABIDINO_DADOS;
  const { FAIXAS, brl, fundoCor, limparHTML, avisar } = S;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));
  const hoje = () => new Date().toISOString().slice(0, 10);
  const num = v => { const n = Number(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };
  const slug = t => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const dataBR = d => d ? d.split('-').reverse().join('/') : '';
  const IDADES = { '1-3a': '1 a 3 anos', '4-10a': '4 a 10 anos', '10-14a': '10 a 14 anos' };
  const STATUS = { novo: 'Novo', pago: 'Pago', enviado: 'Enviado', entregue: 'Entregue', cancelado: 'Cancelado' };
  const nomeCompleto = p => p.tipo + ' Infantil - ' + p.nome;
  const assinatura = d => { const s = JSON.stringify(d); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return s.length + ':' + h; };

  /* ---------- Rascunho: guardado no navegador até publicar ---------- */
  const CHAVE = 'cabidino-rascunho', BASE = assinatura(ORIGINAL);
  let R = clone(ORIGINAL), rascunhoAntigo = false;
  try {
    const g = JSON.parse(localStorage.getItem(CHAVE) || 'null');
    if (g && g.dados) {
      if (JSON.stringify(g.dados) === JSON.stringify(ORIGINAL)) localStorage.removeItem(CHAVE);
      else { R = g.dados; rascunhoAntigo = g.base !== BASE; }
    }
  } catch (e) {}
  const guardar = () => { try { localStorage.setItem(CHAVE, JSON.stringify({ base: BASE, dados: R })); } catch (e) {} atualizarTopo(); };
  const mudou = () => JSON.stringify(R) !== JSON.stringify(ORIGINAL);
  const porId = id => R.produtos.find(p => p.id === id);

  /* ---------- Capacidades do Claude, ou do Supabase quando o site está hospedado (nuvem.js) ---------- */
  const NUVEM = window.CABIDINO_NUVEM || null;
  let artifact = null, db = null, assets = null, usuario = null, pedidos = [], parceiros = {}, dbErro = '';
  const usar = n => (NUVEM ? Promise.resolve(NUVEM[n] || null)
    : window.claude && typeof window.claude.use === 'function' ? window.claude.use(n) : Promise.resolve(null)).catch(() => null);
  const pronto = Promise.all(['artifact', 'db', 'assets', 'user'].map(usar)).then(([a, d, s, u]) => {
    artifact = a; db = d; assets = s; usuario = u;
    if (!db) { dbErro = 'O cofre de pedidos não abriu nesta tela. Abra o site pelo Claude, conectada à sua conta.'; return; }
    db.collection('pedidos').orderBy('criadoEm', 'desc').onSnapshot(snap => {
      pedidos = snap.docs.map(d => Object.assign({ _id: d.id }, d.data())); if (aberto && ['visao', 'pedidos', 'cupons', 'afiliados'].includes(aba)) desenhar();
    }, () => { dbErro = 'Não consegui ler os pedidos agora.'; if (aberto) desenhar(); });
    db.collection('parceiros').onSnapshot(snap => {
      parceiros = {}; snap.docs.forEach(d => { parceiros[d.id] = d.data(); }); if (aberto && ['visao', 'afiliados'].includes(aba)) desenhar();
    }, () => {});
  });

  /* ---------- Regras de preço iguais às do site, lidas do rascunho ---------- */
  const vigente = x => x && x.ativa !== false && x.ativo !== false && (!x.inicio || x.inicio <= hoje()) && (!x.fim || x.fim >= hoje()) && (!x.validade || x.validade >= hoje());
  const naFaixa = (p, k) => p.tamanhos.some(t => t >= FAIXAS[k].min && t <= FAIXAS[k].max);
  const descontoDe = p => Math.min(90, R.promocoes.reduce((m, pr) => vigente(pr) && (pr.alvo === 'todas' || pr.alvo === 'p:' + p.id || (FAIXAS[pr.alvo] && naFaixa(p, pr.alvo))) ? Math.max(m, num(pr.desconto)) : m, 0));
  const precoDe = p => Math.round(p.preco * (1 - descontoDe(p) / 100) * 100) / 100;
  const totalEstoque = p => p.estoque ? Object.values(p.estoque).reduce((a, b) => a + num(b), 0) : null;
  const acabando = p => p.estoque && Object.values(p.estoque).some(v => num(v) > 0 && num(v) <= 2);
  const esgotada = p => p.estoque && totalEstoque(p) === 0;

  /* ---------- Estrutura ---------- */
  const ABAS = [['visao', 'Visão geral'], ['financeiro', 'Financeiro'], ['pedidos', 'Pedidos'], ['produtos', 'Produtos e estoque'], ['promocoes', 'Promoções'], ['cupons', 'Cupons'], ['afiliados', 'Afiliados'], ['planilha', 'Planilha compartilhada'], ['equipe', 'Equipe'], ['textos', 'Textos e loja']];
  let aba = 'visao', aberto = false, editando = null, periodo = 'mes', busca = '', filtroProd = 'todos', formPedido = null, confirmar = null;

  const estilo = document.createElement('style');
  estilo.textContent = `
  #painel{--f-painel:"Plus Jakarta Sans","Nunito",system-ui,-apple-system,"Segoe UI",sans-serif;width:100%;height:100%;max-width:100%;max-height:100%;margin:0;padding:0;border:0;background:var(--creme);color:var(--tinta);font-family:var(--f-painel);font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}
  #painel button,#painel input,#painel select,#painel textarea{font-family:inherit}
  .pn-ceu{position:absolute;inset:0;z-index:-1;pointer-events:none;overflow:hidden}
  #painel::backdrop{background:rgba(40,28,26,.4)}
  .pn{position:relative;isolation:isolate;display:grid;grid-template-rows:auto 1fr;height:100%;padding-top:env(safe-area-inset-top,0px)}
  .pn-topo{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:12px max(16px,env(safe-area-inset-right,0px)) 12px max(16px,env(safe-area-inset-left,0px));background:color-mix(in srgb,var(--papel) 78%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid var(--linha)}
  .pn-marca{display:flex;align-items:center;gap:10px;margin-right:auto}
  .pn-marca svg{width:38px;height:38px;overflow:visible}
  .pn-marca b{font-family:var(--f-titulo);font-size:1.55rem;font-weight:600;letter-spacing:.01em}
  .pn-marca b span{color:var(--rosa)}
  .pn-estado{font-family:var(--f-painel);font-size:.78rem;font-weight:500;padding:4px 10px;border-radius:999px;background:var(--salvia-fundo);color:#3F7F58}
  .pn-estado.pendente{background:#FCEBD9;color:#8C5A20}
  .pn-btn{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:0 14px;border-radius:999px;border:1px solid var(--linha);background:var(--papel);color:var(--tinta);font-family:var(--f-painel);font-size:.86rem;font-weight:500;cursor:pointer;white-space:nowrap}
  .pn-btn:hover{border-color:var(--ouro)}
  .pn-btn[hidden]{display:none}
  .pn-quem{font-size:.8rem;color:var(--tinta-suave)}
  .pn-btn.forte{background:var(--botao);border-color:var(--botao);color:#fff}
  .pn-btn.forte:disabled{opacity:.45;cursor:not-allowed}
  .pn-btn.perigo{color:#B4483F;border-color:#EBC4BF}
  .pn-btn.mini{min-height:32px;padding:0 10px;font-size:.8rem}
  .pn-corpo{display:grid;grid-template-columns:220px 1fr;min-height:0}
  .pn-nav{display:flex;flex-direction:column;gap:4px;padding:16px 10px;border-right:1px solid var(--linha);background:color-mix(in srgb,var(--papel) 55%,transparent);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);overflow-y:auto}
  .pn-nav button{text-align:left;padding:10px 14px;border-radius:12px;border:0;background:none;font-family:var(--f-painel);font-size:.9rem;font-weight:500;color:var(--tinta-suave);cursor:pointer}
  .pn-nav button[aria-current="true"]{background:var(--blush-claro);color:var(--rosa);font-weight:500}
  .pn-main{overflow-y:auto;padding:24px max(16px,env(safe-area-inset-right,0px)) 80px 24px}
  .pn-main h2{font-family:var(--f-painel);font-size:1.6rem;font-weight:700;letter-spacing:-.015em;margin:0 0 6px}
  .pn-sub{color:var(--tinta-suave);font-size:.92rem;margin:0 0 20px;max-width:70ch}
  .pn-barra{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:16px}
  .pn-caixa{background:color-mix(in srgb,var(--papel) 90%,transparent);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);border:1px solid var(--linha);border-radius:18px;padding:18px;min-width:0}
  .pn-grade{display:grid;gap:16px}
  .pn-g4{grid-template-columns:repeat(4,minmax(0,1fr))}
  .pn-g2{grid-template-columns:repeat(2,minmax(0,1fr))}
  .pn-tile small{display:block;font-size:.72rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--tinta-suave);margin-bottom:6px}
  .pn-tile b{font-family:var(--f-painel);font-weight:700;font-size:1.7rem;letter-spacing:-.02em;line-height:1.1;font-variant-numeric:tabular-nums}
  .pn-tile span{display:block;font-size:.8rem;color:var(--tinta-suave);margin-top:6px}
  .pn-caixa h3{font-family:var(--f-painel);font-weight:600;font-size:.98rem;margin:0 0 12px}
  .pn-lista{display:grid;gap:8px;margin:0;padding:0;list-style:none}
  .pn-lista li{display:flex;justify-content:space-between;gap:10px;font-size:.9rem;align-items:center}
  .pn-lista li span:last-child{font-variant-numeric:tabular-nums;color:var(--tinta-suave);white-space:nowrap}
  .pn-vazio{color:var(--tinta-suave);font-size:.9rem;padding:8px 0}
  .pn-tabela{width:100%;border-collapse:collapse;font-size:.88rem}
  .pn-tabela th{text-align:left;font-weight:600;font-size:.7rem;letter-spacing:.06em;text-transform:uppercase;color:var(--tinta-suave);padding:8px;border-bottom:1px solid var(--linha)}
  .pn-tabela td{padding:10px 8px;border-bottom:1px solid var(--linha);vertical-align:middle}
  .pn-tabela tr.clicavel{cursor:pointer}
  .pn-tabela tr.clicavel:hover td{background:var(--nevoa)}
  .pn-rolar{overflow-x:auto}
  .pn-thumb{width:44px;height:58px;object-fit:cover;object-position:top;border-radius:8px;background:var(--nevoa)}
  .pn-chip{display:inline-block;padding:3px 9px;border-radius:999px;font-size:.75rem;font-family:var(--f-painel);background:var(--nevoa);color:var(--tinta-suave);white-space:nowrap}
  .pn-chip.ok{background:var(--salvia-fundo);color:#3F7F58}.pn-chip.alerta{background:#FCEBD9;color:#8C5A20}.pn-chip.ruim{background:#F8DEDB;color:#9A3B32}.pn-chip.rosa{background:var(--blush-claro);color:var(--rosa)}
  .pn-form{display:grid;gap:14px}
  .pn-campos{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px}
  .pn-campo{display:grid;gap:4px;font-size:.82rem;color:var(--tinta-suave);min-width:0}
  .pn-campo.largo{grid-column:1/-1}
  .pn-campo input,.pn-campo select,.pn-campo textarea{width:100%;min-height:40px;padding:8px 12px;border-radius:10px;border:1px solid var(--linha);background:var(--creme);color:var(--tinta);font:inherit;font-size:.92rem}
  .pn-campo textarea{min-height:90px;resize:vertical}
  .pn-campo input:focus,.pn-campo select:focus,.pn-campo textarea:focus{outline:2px solid var(--ouro);outline-offset:1px}
  .pn-check{display:flex;align-items:center;gap:8px;font-size:.9rem}
  .pn-estoque{border-collapse:collapse;font-size:.85rem}
  .pn-estoque th,.pn-estoque td{padding:4px 6px;text-align:center}
  .pn-estoque th{font-weight:500;color:var(--tinta-suave);text-transform:capitalize}
  .pn-estoque input{width:64px;min-height:34px;text-align:center;border-radius:8px;border:1px solid var(--linha);background:var(--creme);font:inherit}
  .pn-estoque input.zero{background:#F8DEDB}
  .pn-editor{display:grid;grid-template-columns:180px 1fr;gap:20px;align-items:start}
  .pn-editor img{width:100%;aspect-ratio:3/4;object-fit:cover;object-position:top;border-radius:14px;background:var(--nevoa)}
  .pn-acoes{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}
  .pn-link{display:flex;gap:8px;align-items:center}
  .pn-link input{flex:1;min-width:0;min-height:36px;border-radius:10px;border:1px solid var(--linha);background:var(--nevoa);padding:0 10px;font-size:.82rem}
  .pn-confirma{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:12px 14px;border-radius:14px;background:#F8DEDB;color:#9A3B32;font-size:.9rem}
  .pn-aviso{padding:12px 14px;border-radius:14px;background:#FCEBD9;color:#8C5A20;font-size:.9rem;margin-bottom:16px}
  .pn-grafico{position:relative}
  .pn-grafico svg{width:100%;height:auto;display:block}
  .pn-dica{position:absolute;pointer-events:none;background:var(--tinta);color:var(--creme);font-size:.8rem;padding:6px 10px;border-radius:8px;white-space:nowrap;transform:translate(-50%,-110%);opacity:0;transition:opacity .15s}
  .pn-item{display:grid;grid-template-columns:minmax(0,2.4fr) minmax(0,1fr) 80px 70px 100px 36px;gap:8px;align-items:end}
  .pn-total{display:flex;justify-content:flex-end;gap:20px;font-family:var(--f-painel);font-variant-numeric:tabular-nums}
  .pn-total b{font-size:1.2rem;font-weight:700}
  body.modo-edicao [data-texto]{outline:2px dashed var(--ouro);outline-offset:4px;border-radius:6px;cursor:text;pointer-events:auto}
  body.modo-edicao [data-texto]:focus{outline-style:solid;background:color-mix(in srgb,var(--papel) 80%,transparent)}
  .pn-barra-edicao{position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:60;display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:center;max-width:calc(100% - 32px);padding:10px 14px;border-radius:20px;background:var(--tinta);color:var(--creme);box-shadow:var(--sombra);font-size:.9rem}
  .pn-barra-edicao .pn-btn{min-height:36px}
  @media (max-width:860px){.pn-corpo{grid-template-columns:1fr;grid-template-rows:auto 1fr}.pn-nav{flex-direction:row;overflow-x:auto;border-right:0;border-bottom:1px solid var(--linha);padding:8px}.pn-nav button{white-space:nowrap}.pn-g4{grid-template-columns:repeat(2,minmax(0,1fr))}.pn-g2{grid-template-columns:1fr}.pn-editor{grid-template-columns:1fr}.pn-editor img{max-width:180px}.pn-main{padding-left:max(16px,env(safe-area-inset-left,0px))}.pn-item{grid-template-columns:1fr 1fr}.pn-item .largo{grid-column:1/-1}}
  @media (prefers-reduced-motion:reduce){.pn-dica{transition:none}}
  `;
  document.head.appendChild(estilo);
  const fonte = document.createElement('link');
  fonte.rel = 'stylesheet'; fonte.href = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap';
  document.head.appendChild(fonte);

  const dlg = document.createElement('dialog');
  dlg.id = 'painel'; dlg.setAttribute('aria-label', 'Painel Cabidino');
  dlg.innerHTML = `<div class="pn">
    <div class="pn-topo">
      <div class="pn-marca"><svg viewBox="0 0 200 200" aria-hidden="true"><use href="#dino"/></svg><b>Painel <span>Cabidino</span></b><span class="pn-estado" id="pn-estado"></span><span class="pn-quem" id="pn-quem"></span></div>
      <button class="pn-btn" type="button" data-acao="espelho">✏️ Editar textos no site</button>
      <button class="pn-btn" type="button" data-acao="descartar" id="pn-descartar">Desfazer alterações</button>
      <button class="pn-btn forte" type="button" data-acao="publicar" id="pn-publicar">Publicar no site</button>
      <button class="pn-btn" type="button" data-acao="fechar">Fechar</button>
      <button class="pn-btn" type="button" data-acao="sair">Sair</button>
    </div>
    <div class="pn-corpo">
      <nav class="pn-nav" aria-label="Seções do painel">${ABAS.map(a => `<button type="button" data-aba="${a[0]}">${a[1]}</button>`).join('')}</nav>
      <main class="pn-main" id="pn-main"></main>
    </div>
  </div>`;
  document.body.appendChild(dlg);
  /* o mesmo céu da tela inicial (dinos, estrelas, Saturno e luzes) atrás do painel */
  const ceu = document.createElement('div');
  ceu.className = 'pn-ceu'; ceu.setAttribute('aria-hidden', 'true'); ceu.innerHTML = ($('#ceu') || { innerHTML: '' }).innerHTML;
  $('.pn', dlg).prepend(ceu);
  const main = $('#pn-main', dlg);

  function atualizarTopo() {
    const m = mudou(), e = $('#pn-estado', dlg);
    e.textContent = m ? 'Alterações ainda não publicadas' : 'Tudo publicado';
    const q = quem(), pq = $('#pn-quem', dlg); if (pq) pq.textContent = q ? 'Olá, ' + q.nome + ' · ' + q.papel : '';
    e.classList.toggle('pendente', m);
    $('#pn-publicar', dlg).disabled = !m; $('#pn-descartar', dlg).hidden = !m;
    const barra = $('#pn-barra-edicao'); if (barra) $('[data-pub]', barra).disabled = !m;
  }

  /* ---------- Helpers de formulário ---------- */
  const campo = (rotulo, nome, valor, tipo = 'text', extra = '') => `<label class="pn-campo${extra.includes('largo') ? ' largo' : ''}">${rotulo}<input name="${nome}" type="${tipo}" value="${esc(valor)}" ${extra.replace('largo', '')}></label>`;
  const selecao = (rotulo, nome, valor, opcoes, extra = '') => `<label class="pn-campo${extra.includes('largo') ? ' largo' : ''}">${rotulo}<select name="${nome}">${opcoes.map(o => `<option value="${esc(o[0])}"${String(o[0]) === String(valor) ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select></label>`;
  const area = (rotulo, nome, valor) => `<label class="pn-campo largo">${rotulo}<textarea name="${nome}">${esc(valor)}</textarea></label>`;
  const marcar = (rotulo, nome, v) => `<label class="pn-check"><input type="checkbox" name="${nome}"${v ? ' checked' : ''}> ${rotulo}</label>`;
  const ler = form => { const o = {}; $$('input,select,textarea', form).forEach(el => { if (!el.name) return; o[el.name] = el.type === 'checkbox' ? el.checked : el.value; }); return o; };
  const vazio = t => `<p class="pn-vazio">${t}</p>`;
  const caixaConfirma = (id, texto, botao) => confirmar === id ? `<div class="pn-confirma">${texto}<button class="pn-btn mini perigo" type="button" data-sim="${esc(id)}">${botao}</button><button class="pn-btn mini" type="button" data-nao>Cancelar</button></div>` : '';

  /* =================== Abas =================== */
  const telas = {};

  /* ---------- Visão geral ---------- */
  telas.visao = () => {
    const agora = new Date(), inicioMes = hoje().slice(0, 8) + '01';
    const corte = periodo === 'mes' ? inicioMes : periodo === '30' ? new Date(agora - 29 * 864e5).toISOString().slice(0, 10) : '0000';
    const validos = pedidos.filter(p => p.status !== 'cancelado' && (p.data || '') >= corte);
    const fat = validos.reduce((a, p) => a + num(p.total), 0), qtdPed = validos.length;
    const pecas = validos.reduce((a, p) => a + (p.itens || []).reduce((b, i) => b + num(i.qtd), 0), 0);
    const vendidos = {}; validos.forEach(p => (p.itens || []).forEach(i => { vendidos[i.nome] = (vendidos[i.nome] || 0) + num(i.qtd); }));
    const top = Object.entries(vendidos).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const porAf = {}; validos.forEach(p => { if (p.afiliado) { const a = porAf[p.afiliado] || (porAf[p.afiliado] = { vendas: 0, pedidos: 0 }); a.vendas += num(p.total); a.pedidos++; } });
    const porCup = {}; validos.forEach(p => { if (p.cupom) porCup[p.cupom] = (porCup[p.cupom] || 0) + 1; });
    const esg = R.produtos.filter(p => p.ativo !== false && esgotada(p)), acab = R.produtos.filter(p => p.ativo !== false && !esgotada(p) && acabando(p));
    const nomeAf = c => (R.afiliados.find(a => a.codigo === c) || { nome: c }).nome;
    return `<h2>Visão geral</h2>
    <p class="pn-sub">Os números de vendas vêm dos pedidos que você registra na aba <b>Pedidos</b>. Os pedidos chegam pelo WhatsApp e lá você cola a mensagem do cliente.</p>
    ${dbErro ? `<div class="pn-aviso">${esc(dbErro)}</div>` : ''}
    <div class="pn-barra">${[['mes', 'Este mês'], ['30', 'Últimos 30 dias'], ['tudo', 'Desde o começo']].map(o => `<button class="pn-btn mini${periodo === o[0] ? ' forte' : ''}" type="button" data-periodo="${o[0]}">${o[1]}</button>`).join('')}</div>
    <div class="pn-grade pn-g4">
      <div class="pn-caixa pn-tile"><small>Faturamento</small><b>${brl(fat)}</b><span>pedidos não cancelados</span></div>
      <div class="pn-caixa pn-tile"><small>Pedidos</small><b>${qtdPed}</b><span>${pedidos.filter(p => p.status === 'novo').length} esperando pagamento</span></div>
      <div class="pn-caixa pn-tile"><small>Ticket médio</small><b>${brl(qtdPed ? fat / qtdPed : 0)}</b><span>valor médio por pedido</span></div>
      <div class="pn-caixa pn-tile"><small>Peças vendidas</small><b>${pecas}</b><span>${R.produtos.filter(p => p.ativo !== false).length} peças no site</span></div>
    </div>
    <div class="pn-caixa" style="margin-top:16px"><h3>Faturamento por dia · últimos 30 dias</h3>${grafico()}</div>
    <div class="pn-grade pn-g2" style="margin-top:16px">
      <div class="pn-caixa"><h3>Mais vendidos</h3>${top.length ? `<ol class="pn-lista">${top.map(t => `<li><span>${esc(t[0])}</span><span>${t[1]} ${t[1] === 1 ? 'peça' : 'peças'}</span></li>`).join('')}</ol>` : vazio('Ainda não há vendas registradas neste período.')}</div>
      <div class="pn-caixa"><h3>Estoque pedindo atenção</h3>${esg.length || acab.length ? `<ul class="pn-lista">${esg.map(p => `<li><span>${esc(nomeCompleto(p))}</span><span class="pn-chip ruim">esgotada</span></li>`).join('')}${acab.slice(0, 8).map(p => `<li><span>${esc(nomeCompleto(p))}</span><span class="pn-chip alerta">acabando</span></li>`).join('')}</ul>` : vazio('Tudo certo: nenhuma peça esgotada ou acabando.')}</div>
      <div class="pn-caixa"><h3>Vendas por afiliado</h3>${Object.keys(porAf).length ? `<ul class="pn-lista">${Object.entries(porAf).map(([c, a]) => `<li><span>${esc(nomeAf(c))} · ${a.pedidos} ${a.pedidos === 1 ? 'pedido' : 'pedidos'}</span><span>${brl(a.vendas)} · comissão ${brl(a.vendas * num((parceiros[c] || {}).comissao) / 100)}</span></li>`).join('')}</ul>` : vazio('Nenhuma venda por indicação neste período.')}</div>
      <div class="pn-caixa"><h3>Cupons usados</h3>${Object.keys(porCup).length ? `<ul class="pn-lista">${Object.entries(porCup).sort((a, b) => b[1] - a[1]).map(([c, n]) => `<li><span>${esc(c)}</span><span>${n} ${n === 1 ? 'vez' : 'vezes'}</span></li>`).join('')}</ul>` : vazio('Nenhum cupom usado neste período.')}</div>
    </div>`;
  };
  function grafico() {
    const dias = []; for (let i = 29; i >= 0; i--) dias.push(new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));
    const val = dias.map(d => pedidos.filter(p => p.status !== 'cancelado' && p.data === d));
    const tot = val.map(l => l.reduce((a, p) => a + num(p.total), 0));
    const max = Math.max(...tot, 0);
    if (!max) return vazio('Quando você registrar pedidos, o gráfico aparece aqui.');
    const passo = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000].find(s => s * 3 >= max) || Math.ceil(max / 3);
    const topo = passo * 3, W = 600, H = 200, e = 44, b = 22, larg = (W - e - 4) / 30, y = v => H - b - (v / topo) * (H - b - 10);
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Faturamento por dia nos últimos 30 dias">`;
    for (let k = 0; k <= 3; k++) { const v = passo * k, yy = y(v); svg += `<line x1="${e}" x2="${W}" y1="${yy}" y2="${yy}" stroke="var(--linha)" stroke-width="1"/><text x="${e - 6}" y="${yy + 4}" text-anchor="end" font-size="10" fill="var(--tinta-suave)">${v >= 1000 ? (v / 1000) + 'k' : v}</text>`; }
    tot.forEach((v, i) => {
      const x = e + i * larg + 1, w = larg - 2, yy = y(v), h = H - b - yy;
      if (h > 0) { const r = Math.min(4, w / 2, h); svg += `<path d="M${x},${H - b}V${yy + r}Q${x},${yy} ${x + r},${yy}H${x + w - r}Q${x + w},${yy} ${x + w},${yy + r}V${H - b}Z" fill="var(--rosa)"/>`; }
      svg += `<rect x="${e + i * larg}" y="0" width="${larg}" height="${H - b}" fill="transparent" data-tip="${esc(dataBR(dias[i]) + ' · ' + brl(v) + ' · ' + val[i].length + (val[i].length === 1 ? ' pedido' : ' pedidos'))}"/>`;
      if (i % 5 === 0 || i === 29) svg += `<text x="${x + w / 2}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--tinta-suave)">${dataBR(dias[i]).slice(0, 5)}</text>`;
    });
    svg += '</svg>';
    grafico.dados = { dias, tot, val };
    return `<div class="pn-grafico">${svg}<div class="pn-dica"></div></div>`;
  }

  /* ---------- Pedidos ---------- */
  const novoPedido = () => ({ data: hoje(), cliente: '', contato: '', itens: [], cupom: '', afiliado: '', frete: 0, status: 'novo', obs: '', baixaEstoque: true });
  function calcular(f) {
    const sub = f.itens.reduce((a, i) => a + num(i.preco) * num(i.qtd), 0);
    const c = R.cupons.find(x => x.codigo === f.cupom);
    const desc = c ? Math.min(sub, c.tipo === 'R$' ? num(c.valor) : sub * num(c.valor) / 100) : 0;
    return { subtotal: Math.round(sub * 100) / 100, desconto: Math.round(desc * 100) / 100, total: Math.round((sub - desc + num(f.frete)) * 100) / 100 };
  }
  telas.pedidos = () => {
    if (!db) return `<h2>Pedidos</h2><div class="pn-aviso">${esc(dbErro || 'Carregando o cofre de pedidos…')}</div>`;
    if (formPedido) return telaFormPedido();
    return `<h2>Pedidos</h2>
    <p class="pn-sub">Registre aqui cada pedido que chegar pelo WhatsApp. Eles ficam guardados só para administradores e alimentam a Visão geral. Ao registrar, o estoque pode baixar sozinho.</p>
    <div class="pn-barra"><button class="pn-btn forte" type="button" data-acao="novo-pedido">+ Registrar pedido</button></div>
    ${pedidos.length ? `<div class="pn-caixa pn-rolar"><table class="pn-tabela"><thead><tr><th>Data</th><th>Cliente</th><th>Peças</th><th>Total</th><th>Indicação / cupom</th><th>Situação</th></tr></thead><tbody>
    ${pedidos.map(p => `<tr class="clicavel" data-pedido="${esc(p._id)}"><td>${dataBR(p.data)}</td><td>${esc(p.cliente || 'Sem nome')}</td><td>${(p.itens || []).reduce((a, i) => a + num(i.qtd), 0)}</td><td>${brl(p.total)}</td><td>${[p.afiliado, p.cupom].filter(Boolean).map(esc).join(' · ') || '—'}</td>
    <td><select data-status="${esc(p._id)}" aria-label="Situação do pedido">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${p.status === k ? ' selected' : ''}>${v}</option>`).join('')}</select></td></tr>`).join('')}
    </tbody></table></div>` : `<div class="pn-caixa">${vazio('Nenhum pedido registrado ainda. Quando um cliente mandar o pedido pelo WhatsApp, clique em "Registrar pedido" e cole a mensagem.')}</div>`}`;
  };
  function telaFormPedido() {
    const f = formPedido, t = calcular(f), novo = !f._id;
    const prods = R.produtos.map(p => [p.id, nomeCompleto(p)]);
    return `<h2>${novo ? 'Registrar pedido' : 'Editar pedido'}</h2>
    <p class="pn-sub">Dica: copie a mensagem que o cliente mandou pelo WhatsApp e cole no campo abaixo. O painel preenche as peças, o cupom e a indicação sozinho.</p>
    <form class="pn-form" id="pn-form-pedido">
      ${novo ? `<div class="pn-caixa pn-form"><label class="pn-campo largo">Mensagem do WhatsApp (opcional)<textarea id="pn-colar" placeholder="Olá, Cabidino! Quero fazer este pedido: …"></textarea></label><div><button class="pn-btn" type="button" data-acao="ler-zap">Ler mensagem e preencher</button></div></div>` : ''}
      <div class="pn-caixa pn-campos">
        ${campo('Data', 'data', f.data, 'date')}${campo('Nome do cliente', 'cliente', f.cliente)}${campo('WhatsApp do cliente', 'contato', f.contato, 'tel')}
        ${selecao('Situação', 'status', f.status, Object.entries(STATUS))}
      </div>
      <div class="pn-caixa pn-form"><h3>Peças</h3>
        ${f.itens.length ? f.itens.map((i, n) => { const p = porId(i.id); return `<div class="pn-item" data-item="${n}">
          ${selecao('Peça', 'i-id', i.id, [['', 'Escolha…']].concat(prods), 'largo')}
          ${selecao('Cor', 'i-cor', i.cor, (p ? p.cores : []).map(c => [c, c]))}
          ${selecao('Tam.', 'i-tam', i.tam, (p ? p.tamanhos : []).map(c => [c, c]))}
          ${campo('Qtd.', 'i-qtd', i.qtd, 'number', 'min="1"')}
          ${campo('Preço un.', 'i-preco', i.preco, 'number', 'step="0.01" min="0"')}
          <button class="pn-btn mini perigo" type="button" data-tirar-item="${n}" aria-label="Tirar peça">✕</button></div>`; }).join('') : vazio('Nenhuma peça ainda.')}
        <div><button class="pn-btn" type="button" data-acao="add-item">+ Adicionar peça</button></div>
      </div>
      <div class="pn-caixa pn-campos">
        ${selecao('Cupom', 'cupom', f.cupom, [['', 'Sem cupom']].concat(R.cupons.map(c => [c.codigo, c.codigo + ' (' + (c.tipo === 'R$' ? brl(c.valor) : c.valor + '%') + ')'])))}
        ${selecao('Indicação de afiliado', 'afiliado', f.afiliado, [['', 'Sem indicação']].concat(R.afiliados.map(a => [a.codigo, a.nome + ' (' + a.codigo + ')'])))}
        ${campo('Frete (R$)', 'frete', f.frete, 'number', 'step="0.01" min="0"')}
        ${area('Observações', 'obs', f.obs)}
      </div>
      <div class="pn-caixa pn-form">
        <div class="pn-total"><span>Subtotal ${brl(t.subtotal)}</span>${t.desconto ? `<span>Desconto − ${brl(t.desconto)}</span>` : ''}<span>Frete ${brl(f.frete)}</span><span>Total <b>${brl(t.total)}</b></span></div>
        ${novo ? marcar('Dar baixa dessas peças no estoque', 'baixaEstoque', f.baixaEstoque) : ''}
        ${caixaConfirma('apagar-pedido', 'Apagar este pedido? Isso não pode ser desfeito.', 'Apagar')}
        <div class="pn-acoes">${novo ? '' : '<button class="pn-btn perigo" type="button" data-acao="apagar-pedido">Apagar pedido</button>'}<button class="pn-btn" type="button" data-acao="cancelar-pedido">Voltar</button><button class="pn-btn forte" type="submit">${novo ? 'Salvar pedido' : 'Salvar alterações'}</button></div>
      </div>
    </form>`;
  }
  function lerFormPedido() {
    const form = $('#pn-form-pedido', dlg); if (!form) return;
    const o = ler(form); ['data', 'cliente', 'contato', 'status', 'cupom', 'afiliado', 'obs'].forEach(k => { if (k in o) formPedido[k] = o[k]; });
    formPedido.frete = num(o.frete); if ('baixaEstoque' in o) formPedido.baixaEstoque = o.baixaEstoque;
    $$('[data-item]', form).forEach(row => {
      const i = formPedido.itens[row.dataset.item], v = ler(row), mudouPeca = v['i-id'] !== i.id;
      i.id = v['i-id']; const p = porId(i.id);
      if (mudouPeca && p) { i.cor = p.cores[0]; i.tam = p.tamanhos[0]; i.preco = precoDe(p); i.nome = nomeCompleto(p); }
      else { i.cor = v['i-cor']; i.tam = num(v['i-tam']); i.qtd = Math.max(1, num(v['i-qtd'])); i.preco = num(v['i-preco']); }
      if (p) i.nome = nomeCompleto(p);
    });
  }
  function lerMensagemZap(texto) {
    const itens = [];
    texto.split(/\n/).forEach(l => {
      const m = /(\d+)\s*x\s+(.+?)\s*\((.+?),\s*tam\.?\s*(\d+)\)/i.exec(l); if (!m) return;
      const nome = m[2].trim().toLowerCase(), p = R.produtos.find(x => nomeCompleto(x).toLowerCase() === nome) || R.produtos.find(x => nome.includes(x.nome.toLowerCase()));
      if (p) itens.push({ id: p.id, nome: nomeCompleto(p), cor: m[3].trim(), tam: num(m[4]), qtd: num(m[1]), preco: precoDe(p) });
    });
    const cup = /cupom:\s*([a-z0-9_-]+)/i.exec(texto), ind = /indica[cç][aã]o:.*\(([a-z0-9_.~-]+)\)/i.exec(texto);
    return { itens, cupom: cup && R.cupons.find(c => c.codigo === cup[1].toUpperCase()) ? cup[1].toUpperCase() : '', afiliado: ind && R.afiliados.find(a => a.codigo === ind[1]) ? ind[1] : '' };
  }
  function baixar(itens, sinal) {
    itens.forEach(i => { const p = porId(i.id); if (!p || !p.estoque) return; const k = i.tam + '|' + i.cor; if (k in p.estoque) p.estoque[k] = Math.max(0, num(p.estoque[k]) - sinal * num(i.qtd)); });
    guardar();
  }
  async function salvarPedido() {
    lerFormPedido(); const f = formPedido;
    if (!f.itens.length || f.itens.some(i => !i.id)) { avisar('Adicione pelo menos uma peça e escolha todas'); return; }
    const t = calcular(f), corpo = { data: f.data, cliente: f.cliente.trim(), contato: f.contato.trim(), itens: f.itens.map(i => ({ id: i.id, nome: i.nome, cor: i.cor, tam: num(i.tam), qtd: num(i.qtd), preco: num(i.preco) })),
      cupom: f.cupom, afiliado: f.afiliado, frete: num(f.frete), status: f.status, obs: f.obs, subtotal: t.subtotal, desconto: t.desconto, total: t.total, baixaEstoque: !!f.baixaEstoque, criadoEm: f.criadoEm || Date.now() };
    try {
      if (f._id) await db.collection('pedidos').doc(f._id).set(corpo);
      else { await db.collection('pedidos').add(corpo); if (f.baixaEstoque) baixar(corpo.itens, 1); }
      avisar(f._id ? 'Pedido atualizado' : f.baixaEstoque ? 'Pedido salvo. O estoque baixou no rascunho: publique para valer no site.' : 'Pedido salvo');
      formPedido = null; confirmar = null; desenhar();
    } catch (e) { avisar('Não consegui salvar o pedido agora. Tente de novo.'); }
  }

  /* ---------- Produtos e estoque ---------- */
  telas.produtos = () => {
    if (editando) return telaEditor();
    const lista = R.produtos.filter(p => {
      if (filtroProd === 'esgotados' && !esgotada(p)) return false;
      if (filtroProd === 'acabando' && !acabando(p)) return false;
      if (filtroProd === 'ocultos' && p.ativo !== false) return false;
      const b = busca.trim(), ehCodigo = /^\d{3,5}$/.test(b);
      return !b || nomeCompleto(p).toLowerCase().includes(b.toLowerCase()) || (ehCodigo && p.tamanhos.some(t => p.cores.some(c => codigoDe(p, t, c).startsWith(b))));
    });
    return `<h2>Produtos e estoque</h2>
    <p class="pn-sub">Clique numa peça para mudar preço, fotos, tamanhos, cores ou estoque. Tamanho com estoque zero aparece riscado no site, e a peça toda zerada ganha o selo "Esgotado".</p>
    <div class="pn-barra">
      <label class="pn-campo" style="flex:1;min-width:200px"><span class="so-leitor">Buscar peça</span><input id="pn-busca" type="search" placeholder="Buscar peça ou código de etiqueta…" value="${esc(busca)}"></label>
      ${[['todos', 'Todas'], ['acabando', 'Acabando'], ['esgotados', 'Esgotadas'], ['ocultos', 'Ocultas']].map(o => `<button class="pn-btn mini${filtroProd === o[0] ? ' forte' : ''}" type="button" data-filtro-prod="${o[0]}">${o[1]}</button>`).join('')}
      <button class="pn-btn forte" type="button" data-acao="nova-peca">+ Nova peça</button>
    </div>
    ${(() => { const v = /^\d{5}$/.test(busca.trim()) && pecaPorCodigo(busca.trim()), pv = v && porId(v.id); return pv ? `<div class="pn-aviso" style="background:var(--salvia-fundo);color:#3F7F58">Código <b>${esc(busca.trim())}</b>: ${esc(nomeCompleto(pv))} · tam. ${esc(v.tam)} · ${esc(v.cor)} · estoque ${num((pv.estoque || {})[v.tam + '|' + v.cor])} un. <button class="pn-btn mini" type="button" data-editar="${esc(pv.id)}">Abrir peça</button></div>` : ''; })()}
    <div class="pn-caixa pn-rolar"><table class="pn-tabela"><thead><tr><th></th><th>Peça</th><th>Idade</th><th>Preço</th><th>Estoque</th><th>Situação</th></tr></thead><tbody>
    ${lista.map(p => { const tot = totalEstoque(p), d = descontoDe(p);
      return `<tr class="clicavel" data-editar="${esc(p.id)}"><td><img class="pn-thumb" src="${esc(p.foto)}" alt="" loading="lazy"></td><td>${esc(nomeCompleto(p))}</td><td>${IDADES[p.idade] || ''}</td>
      <td>${d ? `${brl(precoDe(p))} <s style="color:var(--tinta-suave)">${brl(p.preco)}</s>` : brl(p.preco)}</td><td>${tot == null ? '—' : tot + ' un.'}</td>
      <td>${p.ativo === false ? '<span class="pn-chip">oculta</span>' : esgotada(p) ? '<span class="pn-chip ruim">esgotada</span>' : acabando(p) ? '<span class="pn-chip alerta">acabando</span>' : '<span class="pn-chip ok">à venda</span>'}${d ? ' <span class="pn-chip rosa">−' + d + '%</span>' : ''}</td></tr>`; }).join('') || `<tr><td colspan="6">${vazio('Nenhuma peça encontrada.')}</td></tr>`}
    </tbody></table></div>`;
  };
  function telaEditor() {
    const p = porId(editando); if (!p) { editando = null; return telas.produtos(); }
    const est = p.estoque || {};
    return `<h2>${esc(p.nome || 'Nova peça')}</h2><p class="pn-sub">As mudanças ficam no rascunho. Clique em <b>Publicar no site</b> quando terminar.</p>
    <form class="pn-caixa pn-form" id="pn-form-peca">
      <div class="pn-editor">
        <div class="pn-form"><img src="${esc(p.foto)}" alt="Foto da peça">
          ${assets ? `<label class="pn-btn" style="justify-content:center">Trocar foto<input type="file" accept="image/*" id="pn-foto" hidden></label>` : `<p class="pn-vazio">Para trocar a foto, é preciso abrir o painel como dona ou editora do site.</p>`}
        </div>
        <div class="pn-form">
          <div class="pn-campos">
            ${campo('Nome', 'nome', p.nome)}${campo('Referência (código da roupa)', 'referencia', refDe(p), 'text', 'maxlength="20"')}${selecao('Tipo', 'tipo', p.tipo, [['Conjunto', 'Conjunto'], ['Macacão', 'Macacão'], ['Vestido', 'Vestido'], ['Blusa', 'Blusa'], ['Short', 'Short'], ['Saia', 'Saia'], ['Calça', 'Calça'], ['Body', 'Body'], ['Pijama', 'Pijama']])}
            ${selecao('Faixa de idade', 'idade', p.idade, Object.entries(IDADES))}${campo('Preço (R$)', 'preco', p.preco, 'number', 'step="0.01" min="0"')}
            ${campo('Cores (separe por vírgula)', 'cores', p.cores.join(', '), 'text', 'largo')}${campo('Tamanhos (separe por vírgula)', 'tamanhos', p.tamanhos.join(', '), 'text', 'largo')}
            ${area('Descrição', 'descricao', p.descricao)}
          </div>
          ${marcar('Mostrar esta peça no site', 'ativo', p.ativo !== false)}
          <div><h3>Estoque por tamanho e cor</h3><div class="pn-rolar"><table class="pn-estoque"><thead><tr><th>Tam.</th>${p.cores.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>
          ${p.tamanhos.map(t => `<tr><th>${t}</th>${p.cores.map(c => { const v = num(est[t + '|' + c]); return `<td><input type="number" min="0" data-est="${esc(t + '|' + c)}" value="${v}" class="${v ? '' : 'zero'}" aria-label="Estoque tamanho ${t}, ${esc(c)}"></td>`; }).join('')}</tr>`).join('')}
          </tbody></table></div></div>
        </div>
      </div>
      <div class="pn-caixa" style="background:var(--nevoa)">${secaoEtiquetas(p)}</div>
      ${caixaConfirma('apagar-peca', 'Apagar esta peça do site? Os pedidos antigos continuam guardados.', 'Apagar peça')}
      <div class="pn-acoes"><button class="pn-btn perigo" type="button" data-acao="apagar-peca">Apagar peça</button><button class="pn-btn forte" type="button" data-acao="fechar-editor">Pronto</button></div>
    </form>`;
  }
  function lerPeca() {
    const form = $('#pn-form-peca', dlg), p = porId(editando); if (!form || !p) return;
    const o = ler(form);
    p.nome = o.nome.trim(); if ('referencia' in o && o.referencia.trim() !== refDe(p)) p.referencia = o.referencia.trim(); p.tipo = o.tipo; p.idade = o.idade; p.preco = Math.max(0, num(o.preco)); p.descricao = o.descricao; p.ativo = !!o.ativo;
    const cores = o.cores.split(',').map(s => s.trim().toLowerCase()).filter(Boolean), tams = o.tamanhos.split(',').map(s => num(s)).filter(n => n > 0);
    const est = {}; $$('[data-est]', form).forEach(i => { est[i.dataset.est] = Math.max(0, Math.round(num(i.value))); });
    const mudouGrade = cores.join() !== p.cores.join() || tams.join() !== p.tamanhos.join();
    p.cores = cores.length ? cores : p.cores; p.tamanhos = tams.length ? tams : p.tamanhos;
    const novo = {}; p.tamanhos.forEach(t => p.cores.forEach(c => { const k = t + '|' + c; novo[k] = k in est ? est[k] : num((p.estoque || {})[k]); }));
    p.estoque = novo; guardar();
    return mudouGrade;
  }
  async function trocarFoto(arquivo) {
    if (!assets || !arquivo) return;
    try {
      avisar('Enviando a foto…');
      const img = await new Promise((ok, falha) => { const i = new Image(); i.onload = () => ok(i); i.onerror = falha; i.src = URL.createObjectURL(arquivo); });
      const esc2 = Math.min(1, 1100 / img.height), c = document.createElement('canvas');
      c.width = Math.round(img.width * esc2); c.height = Math.round(img.height * esc2); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', .88));
      const r = await assets.upload(blob);
      porId(editando).foto = r.url; guardar(); desenhar(); avisar('Foto trocada no rascunho');
    } catch (e) { avisar('Não consegui enviar essa foto. Tente outra imagem.'); }
  }

  /* ---------- Promoções ---------- */
  const situacao = x => x.ativa === false || x.ativo === false ? ['pausada', ''] : (x.inicio && x.inicio > hoje()) ? ['agendada', 'alerta'] : ((x.fim && x.fim < hoje()) || (x.validade && x.validade < hoje())) ? ['encerrada', 'ruim'] : ['valendo', 'ok'];
  const alvos = () => [['todas', 'Todas as peças']].concat(Object.keys(FAIXAS).map(k => [k, 'Faixa ' + FAIXAS[k].idade])).concat(R.produtos.map(p => ['p:' + p.id, 'Só: ' + nomeCompleto(p)]));
  telas.promocoes = () => {
    const ed = editando && editando.tipo === 'promo' ? editando : null;
    return `<h2>Promoções</h2><p class="pn-sub">Uma promoção dá desconto automático nas peças escolhidas, entre as datas que você definir. No site aparece o preço riscado, o selo "PROMO" e um filtro "Promoções". Se duas promoções valerem para a mesma peça, fica o maior desconto.</p>
    <div class="pn-barra"><button class="pn-btn forte" type="button" data-acao="nova-promo">+ Nova promoção</button></div>
    ${ed ? formPromo(ed.item) : ''}
    <div class="pn-caixa pn-rolar">${R.promocoes.length ? `<table class="pn-tabela"><thead><tr><th>Nome</th><th>Desconto</th><th>Vale para</th><th>Período</th><th>Situação</th></tr></thead><tbody>
    ${R.promocoes.map((x, n) => { const s = situacao(x); return `<tr class="clicavel" data-editar-promo="${n}"><td>${esc(x.nome)}</td><td>${num(x.desconto)}%</td><td>${esc((alvos().find(a => a[0] === x.alvo) || ['', '—'])[1])}</td><td>${x.inicio ? dataBR(x.inicio) : 'já'} até ${x.fim ? dataBR(x.fim) : 'sem fim'}</td><td><span class="pn-chip ${s[1]}">${s[0]}</span></td></tr>`; }).join('')}</tbody></table>` : vazio('Nenhuma promoção criada ainda.')}</div>`;
  };
  const formPromo = x => `<form class="pn-caixa pn-form" id="pn-form-promo" style="margin-bottom:16px"><h3>${x.nome ? 'Editar promoção' : 'Nova promoção'}</h3><div class="pn-campos">
    ${campo('Nome (só para você)', 'nome', x.nome)}${campo('Desconto (%)', 'desconto', x.desconto, 'number', 'min="1" max="90"')}${selecao('Vale para', 'alvo', x.alvo, alvos(), 'largo')}
    ${campo('Começa em', 'inicio', x.inicio, 'date')}${campo('Termina em', 'fim', x.fim, 'date')}</div>${marcar('Promoção ligada', 'ativa', x.ativa !== false)}
    ${caixaConfirma('apagar-promo', 'Apagar esta promoção?', 'Apagar')}
    <div class="pn-acoes">${editando.novo ? '' : '<button class="pn-btn perigo" type="button" data-acao="apagar-promo">Apagar</button>'}<button class="pn-btn" type="button" data-acao="fechar-editor">Cancelar</button><button class="pn-btn forte" type="submit">Salvar no rascunho</button></div></form>`;

  /* ---------- Cupons ---------- */
  telas.cupons = () => {
    const ed = editando && editando.tipo === 'cupom' ? editando : null;
    const usos = c => pedidos.filter(p => p.cupom === c && p.status !== 'cancelado').length;
    return `<h2>Cupons de desconto</h2><p class="pn-sub">O cliente digita o código na sacola e o desconto aparece na hora. O código também vai junto na mensagem do pedido pelo WhatsApp. Atenção: quem souber o código consegue usar.</p>
    <div class="pn-barra"><button class="pn-btn forte" type="button" data-acao="novo-cupom">+ Novo cupom</button></div>
    ${ed ? formCupom(ed.item) : ''}
    <div class="pn-caixa pn-rolar">${R.cupons.length ? `<table class="pn-tabela"><thead><tr><th>Código</th><th>Desconto</th><th>Compra mínima</th><th>Validade</th><th>Usos</th><th>Situação</th></tr></thead><tbody>
    ${R.cupons.map((c, n) => { const s = situacao(c); return `<tr class="clicavel" data-editar-cupom="${n}"><td><b>${esc(c.codigo)}</b></td><td>${c.tipo === 'R$' ? brl(c.valor) : num(c.valor) + '%'}</td><td>${num(c.minimo) ? brl(c.minimo) : '—'}</td><td>${c.validade ? dataBR(c.validade) : 'sem prazo'}</td><td>${usos(c.codigo)}</td><td><span class="pn-chip ${s[1]}">${s[0]}</span></td></tr>`; }).join('')}</tbody></table>` : vazio('Nenhum cupom criado ainda. Que tal um "BEMVINDA10" para a primeira compra?')}</div>`;
  };
  const formCupom = c => `<form class="pn-caixa pn-form" id="pn-form-cupom" style="margin-bottom:16px"><h3>${c.codigo ? 'Editar cupom' : 'Novo cupom'}</h3><div class="pn-campos">
    ${campo('Código', 'codigo', c.codigo, 'text', 'maxlength="20" style="text-transform:uppercase"')}${selecao('Tipo de desconto', 'tipo', c.tipo, [['%', 'Porcentagem (%)'], ['R$', 'Valor fixo (R$)']])}
    ${campo('Valor do desconto', 'valor', c.valor, 'number', 'min="1" step="0.01"')}${campo('Compra mínima (R$)', 'minimo', c.minimo, 'number', 'min="0" step="0.01"')}${campo('Vale até', 'validade', c.validade, 'date')}</div>
    ${marcar('Cupom ligado', 'ativo', c.ativo !== false)}${caixaConfirma('apagar-cupom', 'Apagar este cupom?', 'Apagar')}
    <div class="pn-acoes">${editando.novo ? '' : '<button class="pn-btn perigo" type="button" data-acao="apagar-cupom">Apagar</button>'}<button class="pn-btn" type="button" data-acao="fechar-editor">Cancelar</button><button class="pn-btn forte" type="submit">Salvar no rascunho</button></div></form>`;

  /* ---------- Afiliados ---------- */
  /* hospedado, enquanto o link guardado ainda for o do Claude, os links de afiliados usam o endereço novo */
  const linkDe = a => (NUVEM && !/^https?:\/\/(?!claude\.ai)/.test(R.loja.linkLoja || '') ? location.origin + location.pathname : (R.loja.linkLoja || '')).replace(/#.*$/, '') + '#indica-' + a.codigo;
  telas.afiliados = () => {
    const ed = editando && editando.tipo === 'afiliado' ? editando : null;
    const stats = c => { const l = pedidos.filter(p => p.afiliado === c && p.status !== 'cancelado'); const v = l.reduce((a, p) => a + num(p.total), 0); return { n: l.length, v, com: v * num((parceiros[c] || {}).comissao) / 100 }; };
    return `<h2>Afiliados</h2><p class="pn-sub">Cada afiliada ganha um link só dela. Quem entra pelo link fica marcado por 30 dias, e o nome dela vai junto na mensagem do pedido. Ao registrar o pedido, a indicação já vem preenchida, e a comissão é calculada aqui. A comissão e o contato ficam só no cofre do painel; o site mostra apenas o nome.</p>
    ${!db ? `<div class="pn-aviso">${esc(dbErro || 'Carregando…')} A comissão e o contato não vão aparecer.</div>` : ''}
    <div class="pn-barra"><button class="pn-btn forte" type="button" data-acao="novo-afiliado">+ Nova afiliada</button></div>
    ${ed ? formAfiliado(ed.item) : ''}
    <div class="pn-grade">${R.afiliados.length ? R.afiliados.map((a, n) => { const s = stats(a.codigo), pv = parceiros[a.codigo] || {};
      return `<div class="pn-caixa pn-form"><div class="pn-barra" style="margin:0;justify-content:space-between"><h3 style="margin:0">${esc(a.nome)} <span class="pn-chip ${a.ativo === false ? '' : 'ok'}">${a.ativo === false ? 'pausada' : 'ativa'}</span></h3><button class="pn-btn mini" type="button" data-editar-afiliado="${n}">Editar</button></div>
      <div class="pn-link"><input readonly value="${esc(linkDe(a))}" aria-label="Link de indicação de ${esc(a.nome)}"><button class="pn-btn mini" type="button" data-copiar="${esc(linkDe(a))}">Copiar link</button></div>
      <ul class="pn-lista"><li><span>Pedidos indicados</span><span>${s.n}</span></li><li><span>Vendas</span><span>${brl(s.v)}</span></li><li><span>Comissão (${num(pv.comissao)}%)</span><span>${brl(s.com)}</span></li>${pv.contato ? `<li><span>Contato</span><span>${esc(pv.contato)}</span></li>` : ''}</ul></div>`; }).join('') : `<div class="pn-caixa">${vazio('Nenhuma afiliada ainda.')}</div>`}</div>`;
  };
  const formAfiliado = a => { const pv = parceiros[a.codigo] || {}; return `<form class="pn-caixa pn-form" id="pn-form-afiliado" style="margin-bottom:16px"><h3>${a.codigo ? 'Editar afiliada' : 'Nova afiliada'}</h3><div class="pn-campos">
    ${campo('Nome (aparece para o cliente)', 'nome', a.nome)}${campo('Código do link (letras e números)', 'codigo', a.codigo, 'text', 'maxlength="24"' + (editando.novo ? '' : ' readonly'))}
    ${campo('Comissão (%)', 'comissao', pv.comissao || '', 'number', 'min="0" max="100" step="0.5"')}${campo('Contato (WhatsApp ou Instagram)', 'contato', pv.contato || '')}</div>
    ${marcar('Afiliada ativa', 'ativo', a.ativo !== false)}${caixaConfirma('apagar-afiliado', 'Apagar esta afiliada? O link dela deixa de funcionar.', 'Apagar')}
    <div class="pn-acoes">${editando.novo ? '' : '<button class="pn-btn perigo" type="button" data-acao="apagar-afiliado">Apagar</button>'}<button class="pn-btn" type="button" data-acao="fechar-editor">Cancelar</button><button class="pn-btn forte" type="submit">Salvar</button></div></form>`; };

  /* ---------- Textos e loja ---------- */
  const ROTULOS = { 'hero-frase': 'Frase abaixo da logo', 'hero-sub': 'Frase pequena do topo', 'promessa-1': 'Faixa de vantagens (1)', 'promessa-3': 'Faixa de vantagens (3)', 'fases-kicker': 'Idades: chamada', 'fases-titulo': 'Idades: título', 'fases-texto': 'Idades: texto',
    'vitrine-kicker': 'Vitrine: chamada', 'vitrine-titulo': 'Vitrine: título', 'dicas-kicker': 'Tamanhos: chamada', 'dicas-titulo': 'Tamanhos: título', 'dicas-texto': 'Tamanhos: texto', 'dicas-nota': 'Tamanhos: observação',
    'rodape-descricao': 'Rodapé: descrição', 'rodape-feito': 'Rodapé: "feito com amor"', 'rodape-lema': 'Rodapé: lema', 'rodape-beijo': 'Rodapé: recado final', 'jogo-convite': 'Joguinho: convite' };
  telas.textos = () => {
    const l = R.loja, editados = Object.keys(R.textos).filter(k => R.textos[k]);
    return `<h2>Textos e loja</h2><p class="pn-sub">Para mudar os textos do site, clique em <b>✏️ Editar textos no site</b>: o site abre com os textos contornados, e é só clicar e escrever. Aqui embaixo ficam os contatos, os avisos e as falas do Dino.</p>
    <div class="pn-barra"><button class="pn-btn forte" type="button" data-acao="espelho">✏️ Editar textos no site</button></div>
    <form class="pn-caixa pn-form" id="pn-form-loja"><h3>Dados da loja</h3><div class="pn-campos">
      ${campo('WhatsApp (55 + DDD + número)', 'whatsapp', l.whatsapp, 'tel')}${campo('Instagram (sem @)', 'instagram', l.instagram)}${campo('E-mail', 'email', l.email, 'email')}${campo('Site', 'site', l.site)}
      ${campo('Frete grátis acima de (R$)', 'freteGratisAcima', l.freteGratisAcima, 'number', 'min="0"')}${campo('Parcelas sem juros (0 = não mostrar)', 'parcelasSemJuros', l.parcelasSemJuros, 'number', 'min="0" max="12"')}
      ${campo('Razão social', 'razaoSocial', l.razaoSocial)}${campo('CNPJ', 'cnpj', l.cnpj)}${campo('Cidade', 'cidade', l.cidade)}${campo('Link da loja (para os links de afiliados)', 'linkLoja', l.linkLoja, 'url', 'largo')}
      ${area('Avisos da faixa rosa do topo (um por linha)', 'recados', R.recados.join('\n'))}${area('Falas do Dino no topo (uma por linha)', 'falas', R.falas.join('\n'))}
    </div><div class="pn-acoes"><button class="pn-btn forte" type="submit">Salvar no rascunho</button></div></form>
    <div class="pn-caixa" style="margin-top:16px"><h3>Textos que você já mudou</h3>${editados.length ? `<ul class="pn-lista">${editados.map(k => `<li><span><b>${esc(ROTULOS[k] || k)}:</b> ${esc(R.textos[k].replace(/<[^>]+>/g, ''))}</span><button class="pn-btn mini" type="button" data-texto-original="${esc(k)}">Voltar ao original</button></li>`).join('')}</ul>` : vazio('Nenhum texto mudado ainda.')}</div>`;
  };

  /* =================== Desenho e eventos =================== */
  function desenhar() {
    $$('[data-aba]', dlg).forEach(b => b.setAttribute('aria-current', String(b.dataset.aba === aba)));
    const rolagem = main.scrollTop;
    main.innerHTML = (rascunhoAntigo ? `<div class="pn-aviso">O site foi publicado depois que você começou este rascunho. Se publicar, as suas alterações substituem as de lá. <button class="pn-btn mini" type="button" data-acao="descartar">Descartar meu rascunho</button> <button class="pn-btn mini" type="button" data-acao="manter">Continuar com ele</button></div>` : '') + telas[aba]();
    main.scrollTop = rolagem; atualizarTopo();
    if (aba === 'planilha' && focoPend) { const alvo = main.querySelector('[data-cel="' + focoPend + '"]'); focoPend = null; if (alvo) alvo.focus(); }
  }
  function irPara(a) { aba = a; editando = null; previaEtq = null; formPedido = null; finForm = null; confirmar = null; main.scrollTop = 0; desenhar(); }

  dlg.addEventListener('click', async e => {
    const t = e.target, el = s => t.closest(s);
    if (el('[data-aba]')) return irPara(el('[data-aba]').dataset.aba);
    if (el('[data-periodo]')) { periodo = el('[data-periodo]').dataset.periodo; return desenhar(); }
    if (el('[data-filtro-prod]')) { filtroProd = el('[data-filtro-prod]').dataset.filtroProd; return desenhar(); }
    if (el('[data-editar]')) { editando = el('[data-editar]').dataset.editar; main.scrollTop = 0; return desenhar(); }
    if (el('[data-editar-promo]')) { editando = { tipo: 'promo', idx: +el('[data-editar-promo]').dataset.editarPromo, item: clone(R.promocoes[+el('[data-editar-promo]').dataset.editarPromo]) }; return desenhar(); }
    if (el('[data-editar-cupom]')) { editando = { tipo: 'cupom', idx: +el('[data-editar-cupom]').dataset.editarCupom, item: clone(R.cupons[+el('[data-editar-cupom]').dataset.editarCupom]) }; return desenhar(); }
    if (el('[data-editar-afiliado]')) { editando = { tipo: 'afiliado', idx: +el('[data-editar-afiliado]').dataset.editarAfiliado, item: clone(R.afiliados[+el('[data-editar-afiliado]').dataset.editarAfiliado]) }; return desenhar(); }
    if (el('[data-pedido]') && !el('select')) { const p = pedidos.find(x => x._id === el('[data-pedido]').dataset.pedido); formPedido = clone(p); main.scrollTop = 0; return desenhar(); }
    if (el('[data-tirar-item]')) { lerFormPedido(); formPedido.itens.splice(+el('[data-tirar-item]').dataset.tirarItem, 1); return desenhar(); }
    if (el('[data-copiar]')) { const v = el('[data-copiar]').dataset.copiar; try { await navigator.clipboard.writeText(v); avisar('Link copiado!'); } catch (er) { const i = el('[data-copiar]').previousElementSibling; i.select(); avisar('Selecione e copie o link'); } return; }
    if (el('[data-texto-original]')) { delete R.textos[el('[data-texto-original]').dataset.textoOriginal]; guardar(); return desenhar(); }
    if (el('[data-nao]')) { confirmar = null; return desenhar(); }
    if (el('[data-sim]')) return confirmado(el('[data-sim]').dataset.sim);
    const b = el('[data-acao]'); if (!b) return;
    const acao = b.dataset.acao;
    if (acao === 'fechar') return fechar();
    if (acao === 'sair') { sairDoPainel(); return; }
    if (acao === 'publicar') return publicar();
    if (acao === 'espelho') return modoEdicao(true);
    if (acao === 'descartar') { confirmar = 'descartar'; main.innerHTML = caixaConfirma('descartar', 'Desfazer todas as alterações que ainda não foram publicadas?', 'Desfazer') + main.innerHTML; return; }
    if (acao === 'manter') { rascunhoAntigo = false; return desenhar(); }
    if (acao === 'novo-pedido') { formPedido = novoPedido(); return desenhar(); }
    if (acao === 'cancelar-pedido') { formPedido = null; confirmar = null; return desenhar(); }
    if (acao === 'add-item') { lerFormPedido(); const p = R.produtos[0]; formPedido.itens.push({ id: '', nome: '', cor: '', tam: '', qtd: 1, preco: 0 }); return desenhar(); }
    if (acao === 'ler-zap') { lerFormPedido(); const r = lerMensagemZap($('#pn-colar', dlg).value); if (!r.itens.length) { avisar('Não achei peças nessa mensagem. Adicione à mão.'); return; } formPedido.itens = r.itens; if (r.cupom) formPedido.cupom = r.cupom; if (r.afiliado) formPedido.afiliado = r.afiliado; avisar(r.itens.length + (r.itens.length === 1 ? ' peça encontrada' : ' peças encontradas')); return desenhar(); }
    if (acao === 'apagar-pedido' || acao === 'apagar-peca' || acao === 'apagar-promo' || acao === 'apagar-cupom' || acao === 'apagar-afiliado') { confirmar = acao; return desenhar(); }
    if (acao === 'nova-peca') { const id = 'peca-' + Date.now().toString(36); R.produtos.unshift({ id, nome: 'Nova peça', tipo: 'Conjunto', idade: '4-10a', preco: 0, cores: ['rosa'], tamanhos: [4, 6, 8, 10], foto: 'logo-cabidino-transparente.png', descricao: '', ativo: false, estoque: { '4|rosa': 0, '6|rosa': 0, '8|rosa': 0, '10|rosa': 0 } }); guardar(); editando = id; filtroProd = 'todos'; return desenhar(); }
    if (acao === 'fechar-editor') { if (aba === 'produtos') lerPeca(); editando = null; previaEtq = null; confirmar = null; return desenhar(); }
    if (acao === 'nova-promo') { editando = { tipo: 'promo', novo: true, item: { nome: '', desconto: 10, alvo: 'todas', inicio: hoje(), fim: '', ativa: true } }; return desenhar(); }
    if (acao === 'novo-cupom') { editando = { tipo: 'cupom', novo: true, item: { codigo: '', tipo: '%', valor: 10, minimo: 0, validade: '', ativo: true } }; return desenhar(); }
    if (acao === 'novo-afiliado') { editando = { tipo: 'afiliado', novo: true, item: { codigo: '', nome: '', ativo: true } }; return desenhar(); }
  });
  async function confirmado(o) {
    confirmar = null;
    if (o === 'descartar') { R = clone(ORIGINAL); rascunhoAntigo = false; try { localStorage.removeItem(CHAVE); } catch (e) {} editando = null; atualizarTopo(); avisar('Alterações desfeitas'); return desenhar(); }
    if (o === 'apagar-pedido') { try { if (formPedido.baixaEstoque) baixar(formPedido.itens, -1); await db.collection('pedidos').doc(formPedido._id).delete(); avisar(formPedido.baixaEstoque ? 'Pedido apagado e peças devolvidas ao estoque (no rascunho)' : 'Pedido apagado'); formPedido = null; } catch (e) { avisar('Não consegui apagar agora.'); } return desenhar(); }
    if (o === 'apagar-peca') { R.produtos = R.produtos.filter(p => p.id !== editando); R.promocoes = R.promocoes.filter(x => x.alvo !== 'p:' + editando); editando = null; guardar(); avisar('Peça apagada do rascunho'); return desenhar(); }
    if (o === 'apagar-promo') { R.promocoes.splice(editando.idx, 1); editando = null; guardar(); return desenhar(); }
    if (o === 'apagar-cupom') { R.cupons.splice(editando.idx, 1); editando = null; guardar(); return desenhar(); }
    if (o === 'apagar-afiliado') { const c = R.afiliados[editando.idx].codigo; R.afiliados.splice(editando.idx, 1); editando = null; guardar(); if (db) db.collection('parceiros').doc(c).delete().catch(() => {}); return desenhar(); }
  }
  dlg.addEventListener('submit', async e => {
    e.preventDefault(); const f = e.target, o = ler(f);
    if (f.id === 'pn-form-pedido') return salvarPedido();
    if (f.id === 'pn-form-promo') {
      const x = { nome: o.nome.trim() || 'Promoção', desconto: Math.min(90, Math.max(1, Math.round(num(o.desconto)))), alvo: o.alvo, inicio: o.inicio, fim: o.fim, ativa: !!o.ativa };
      if (x.fim && x.inicio && x.fim < x.inicio) { avisar('A data de término vem antes do começo'); return; }
      if (editando.novo) R.promocoes.push(x); else R.promocoes[editando.idx] = x; editando = null; guardar(); avisar('Promoção salva no rascunho'); return desenhar();
    }
    if (f.id === 'pn-form-cupom') {
      const x = { codigo: o.codigo.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, ''), tipo: o.tipo, valor: Math.max(0, num(o.valor)), minimo: Math.max(0, num(o.minimo)), validade: o.validade, ativo: !!o.ativo };
      if (!x.codigo) { avisar('Escreva um código para o cupom'); return; }
      if (x.tipo === '%' && x.valor > 90) { avisar('O desconto máximo é 90%'); return; }
      if (R.cupons.some((c, n) => c.codigo === x.codigo && (editando.novo || n !== editando.idx))) { avisar('Já existe um cupom com esse código'); return; }
      if (editando.novo) R.cupons.push(x); else R.cupons[editando.idx] = x; editando = null; guardar(); avisar('Cupom salvo no rascunho'); return desenhar();
    }
    if (f.id === 'pn-form-afiliado') {
      const codigo = editando.novo ? slug(o.codigo || o.nome).replace(/-/g, '').slice(0, 24) : editando.item.codigo;
      if (!o.nome.trim() || !codigo) { avisar('Preencha o nome da afiliada'); return; }
      if (editando.novo && R.afiliados.some(a => a.codigo === codigo)) { avisar('Esse código já está em uso'); return; }
      const x = { codigo, nome: o.nome.trim(), ativo: !!o.ativo };
      if (editando.novo) R.afiliados.push(x); else R.afiliados[editando.idx] = x;
      if (db) { try { await db.collection('parceiros').doc(codigo).set({ comissao: Math.max(0, num(o.comissao)), contato: o.contato.trim() }); } catch (er) { avisar('A comissão não foi salva agora.'); } }
      editando = null; guardar(); avisar('Afiliada salva. Publique o site para o link dela funcionar.'); return desenhar();
    }
    if (f.id === 'pn-form-loja') {
      ['whatsapp', 'instagram', 'email', 'site', 'razaoSocial', 'cnpj', 'cidade', 'linkLoja'].forEach(k => { R.loja[k] = String(o[k] || '').trim(); });
      R.loja.whatsapp = R.loja.whatsapp.replace(/\D/g, ''); R.loja.instagram = R.loja.instagram.replace(/^@/, '');
      R.loja.freteGratisAcima = Math.max(0, num(o.freteGratisAcima)); R.loja.parcelasSemJuros = Math.max(0, Math.round(num(o.parcelasSemJuros)));
      R.recados = o.recados.split('\n').map(s => s.trim()).filter(Boolean); R.falas = o.falas.split('\n').map(s => s.trim()).filter(Boolean);
      guardar(); avisar('Dados salvos no rascunho'); return desenhar();
    }
  });
  dlg.addEventListener('change', e => {
    const t = e.target;
    if (t.matches('[data-status]')) { db.collection('pedidos').doc(t.dataset.status).update({ status: t.value }).then(() => avisar('Situação atualizada')).catch(() => avisar('Não consegui mudar agora')); return; }
    if (t.id === 'pn-foto') return trocarFoto(t.files[0]);
    if (t.closest('#pn-form-peca')) { const grade = lerPeca(); if (grade || t.matches('[data-est]')) desenhar(); return; }
    if (t.closest('#pn-form-pedido')) { lerFormPedido(); desenhar(); }
  });
  dlg.addEventListener('input', e => {
    if (e.target.id === 'pn-busca') { busca = e.target.value; const pos = e.target.selectionStart; desenhar(); const i = $('#pn-busca', dlg); i.focus(); i.setSelectionRange(pos, pos); }
  });
  /* dica do gráfico */
  dlg.addEventListener('pointermove', e => {
    const r = e.target.closest && e.target.closest('[data-tip]'), area = e.target.closest && e.target.closest('.pn-grafico');
    $$('.pn-dica', dlg).forEach(d => { if (!area || !area.contains(d) || !r) d.style.opacity = 0; });
    if (!r || !area) return;
    const dica = $('.pn-dica', area), caixa = area.getBoundingClientRect(), rr = r.getBoundingClientRect();
    dica.textContent = r.dataset.tip;
    dica.style.left = Math.min(caixa.width - 60, Math.max(60, rr.left - caixa.left + rr.width / 2)) + 'px'; dica.style.top = (e.clientY - caixa.top) + 'px'; dica.style.opacity = 1;
  });  dlg.addEventListener('cancel', e => { e.preventDefault(); fechar(); });

  /* ---------- Publicar: monta a página nova a partir do modelo e publica ---------- */
  async function publicar() {
    if (aba === 'produtos' && editando) lerPeca();
    if (!mudou()) return;
    await pronto;
    if (!artifact && !NUVEM) { avisar('Publicar só funciona com o site aberto pelo Claude.'); return; }
    const bt = $('#pn-publicar', dlg), barra = $('#pn-barra-edicao'); bt.disabled = true; bt.textContent = 'Publicando…'; if (barra) $('[data-pub]', barra).textContent = 'Publicando…';
    try {
      if (NUVEM) {
        /* hospedado: o catálogo vai para o banco, e todo visitante passa a ver a versão nova */
        await NUVEM.salvarLoja(R);
        try { localStorage.removeItem(CHAVE); sessionStorage.setItem('cabidino-reabrir-painel', document.body.classList.contains('modo-edicao') ? '' : aba); } catch (e) {}
        avisar('Publicado! O site está sendo atualizado…');
        setTimeout(() => location.reload(), 1200);
        return;
      }
      const resp = await fetch('modelo.html', { cache: 'no-store' }); if (!resp.ok) throw { code: 'modelo' };
      const modelo = await resp.text(); if (!modelo.includes('__DADOS_DA_LOJA__')) throw { code: 'modelo' };
      const json = JSON.stringify(R).replace(/</g, '\\u003c');
      try { sessionStorage.setItem('cabidino-reabrir-painel', document.body.classList.contains('modo-edicao') ? '' : aba); } catch (e) {}
      const pagina = modelo.replace('__DADOS_DA_LOJA__', () => json);
      /* primeiro troca só a página e mantém fotos e arquivos como estão; se essa forma não estiver liberada, publica a página inteira */
      let soPagina = true;
      try { await artifact.publish({ 'index.html': { content: pagina, contentType: 'text/html' } }); }
      catch (e1) { if (['capability_disabled', 'capability_removed', 'invalid_content', 'transform_error'].includes(e1 && e1.code)) { soPagina = false; await artifact.publish(pagina); } else throw e1; }
      try { localStorage.removeItem(CHAVE); } catch (e) {}
      avisar('Publicado! O site está sendo atualizado…');
      if (soPagina) setTimeout(() => location.reload(), 1200);
    } catch (e) {
      const c = e && e.code;
      const msg = c === 'conflict' ? 'Alguém publicou o site agora há pouco. A página vai recarregar e o seu rascunho continua guardado.'
        : c === 'not_writer' || c === 'not_granted' ? 'Você está vendo o site sem permissão para publicar. Entre como dona ou editora.'
        : c === 'rate_limited' ? 'Muitas publicações seguidas. Espere um minutinho e tente de novo.'
        : c === 'too_large' ? 'O site ficou grande demais para publicar. Tente tirar fotos ou peças que não usa.'
        : c === 'modelo' ? 'Não achei o modelo do site para publicar. Peça ajuda ao Claude.'
        : 'Não deu para publicar agora. Tente de novo em instantes.';
      avisar(msg); try { sessionStorage.removeItem('cabidino-reabrir-painel'); } catch (er) {}
      bt.textContent = 'Publicar no site'; if (barra) $('[data-pub]', barra).textContent = 'Publicar no site'; atualizarTopo();
    }
  }

  /* ---------- Espelho do site: editar os textos direto na página ---------- */
  let barraEd = null;
  const pararJogo = e => { if (document.body.classList.contains('modo-edicao') && e.target.closest('[data-texto]')) e.stopPropagation(); };
  function modoEdicao(ligar) {
    const els = $$('[data-texto]');
    if (ligar) {
      if (dlg.open) dlg.close(); aberto = false;
      document.body.classList.add('modo-edicao');
      els.forEach(el => { el.hidden = false; el.contentEditable = 'true'; el.spellcheck = true; });
      document.addEventListener('pointerdown', pararJogo, true); document.addEventListener('keydown', pararJogo, true);
      if (!barraEd) {
        barraEd = document.createElement('div'); barraEd.className = 'pn-barra-edicao'; barraEd.id = 'pn-barra-edicao';
        barraEd.innerHTML = '<span>✏️ Clique nos textos com contorno dourado e escreva.</span><button class="pn-btn forte" type="button" data-pub>Publicar no site</button><button class="pn-btn" type="button" data-volta>Voltar ao painel</button>';
        barraEd.addEventListener('click', e => { if (e.target.closest('[data-pub]')) publicar(); if (e.target.closest('[data-volta]')) { modoEdicao(false); abrir(aba); } });
        document.body.appendChild(barraEd);
      }
      barraEd.hidden = false; atualizarTopo();
      $('[data-texto]').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      document.body.classList.remove('modo-edicao');
      els.forEach(el => { el.removeAttribute('contenteditable'); });
      document.removeEventListener('pointerdown', pararJogo, true); document.removeEventListener('keydown', pararJogo, true);
      if (barraEd) barraEd.hidden = true;
    }
  }
  document.addEventListener('input', e => {
    const el = e.target.closest && e.target.closest('[data-texto]'); if (!el || !document.body.classList.contains('modo-edicao')) return;
    R.textos[el.dataset.texto] = limparHTML(el.innerHTML).replace(/&nbsp;/g, ' ').trim(); guardar();
  });
  document.addEventListener('paste', e => {
    if (!document.body.classList.contains('modo-edicao') || !e.target.closest || !e.target.closest('[data-texto]')) return;
    e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain'));
  });

  /* ---------- Login do painel: cada pessoa da equipe tem usuário e senha (guardada como "impressão digital" PBKDF2 no cofre) ---------- */
  const SESSAO = 'cabidino-painel-ok';
  const quem = () => { try { const v = JSON.parse(sessionStorage.getItem(SESSAO) || 'null'); return v && v.usuario ? v : null; } catch (e) { return null; } };
  const logado = () => !!quem();
  const hex = b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
  const deHex = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
  const chaveDe = t => slug(t).replace(/-/g, '');
  const capitalizar = t => String(t).charAt(0).toUpperCase() + String(t).slice(1);
  async function impressao(senha, sal, voltas) {
    const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']);
    return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: sal, iterations: voltas, hash: 'SHA-256' }, chave, 256));
  }
  const acessoRef = () => db.collection('configuracao').doc('acesso');
  /* lê a equipe; entende também o formato antigo, de uma pessoa só */
  async function lerEquipe() {
    const s = await acessoRef().get(); if (!s.exists) return null;
    const d = s.data();
    if (d.usuarios) return clone(d.usuarios);
    if (d.usuario) return { [d.usuario]: { nome: capitalizar(d.usuario), papel: 'Dona', sal: d.sal, voltas: d.voltas, impressao: d.impressao } };
    return null;
  }
  const gravarEquipe = eq => acessoRef().set({ usuarios: eq, atualizadoEm: Date.now() });
  async function comSenha(pessoa, senha) {
    const sal = crypto.getRandomValues(new Uint8Array(16));
    return Object.assign({}, pessoa, { sal: hex(sal), voltas: 150000, impressao: await impressao(senha, sal, 150000) });
  }
  const confere = async (senha, p) => !!(p && p.impressao && (await impressao(senha, deHex(p.sal), p.voltas)) === p.impressao);
  let tentativas = 0, bloqueadoAte = 0, depoisDoLogin = null, convidado = null;

  const telaLogin = document.createElement('dialog');
  telaLogin.className = 'janela-aviso pn-login'; telaLogin.setAttribute('aria-labelledby', 'pn-login-titulo');
  document.body.appendChild(telaLogin);
  estilo.textContent += `.pn-login form{display:grid;gap:12px;width:100%;text-align:left}.pn-login .pn-campo input{min-height:46px}.pn-login .btn{width:100%}
  .pn-login{font-family:"Plus Jakarta Sans","Nunito",system-ui,sans-serif}.pn-login h3{font-family:var(--f-titulo)}.pn-login .pn-campo input{font-family:inherit}
  .pn-login .pn-erro{color:#B4483F;font-size:.88rem;min-height:1.2em;text-align:center}.pn-login .pn-link-btn{border:0;background:none;color:var(--tinta-suave);text-decoration:underline;cursor:pointer;font-size:.85rem;justify-self:center}`;
  const camposSenha = (rotulo = 'Senha (mínimo 6 letras ou números)') => campo(rotulo, 'senha', '', 'password', 'autocomplete="new-password" required minlength="6"') + campo('Repita a senha', 'repete', '', 'password', 'autocomplete="new-password" required minlength="6"');
  function desenharLogin(modo, erro = '') {
    const topo = `<svg viewBox="0 0 200 200" aria-hidden="true"><use href="#dino-astro"/></svg><h3 id="pn-login-titulo">Painel Cabidino</h3>`;
    const rodape = `<button class="pn-link-btn" type="button" data-login="voltar">Voltar para a loja</button>`;
    const er = `<p class="pn-erro" aria-live="polite">${esc(erro)}</p>`;
    const telas = {
      carregando: `<p>Conferindo seu acesso…</p>`,
      erro: `<p>Não consegui conferir a senha agora. Abra o site pelo Claude, com a conta que tem acesso à loja.</p><button class="btn" type="button" data-login="tentar">Tentar de novo</button>`,
      criar: `<p>Primeira vez por aqui! Crie o seu usuário e a senha do painel.</p>
        <form data-form="criar">${campo('Usuário', 'usuario', '', 'text', 'autocomplete="username" required maxlength="40"')}${camposSenha()}${er}<button class="btn" type="submit">Criar senha e entrar</button></form>`,
      entrar: `<p>Digite o seu usuário e a senha do painel.</p>
        <form data-form="entrar">${campo('Usuário', 'usuario', '', 'text', 'autocomplete="username" required maxlength="40"')}${campo('Senha', 'senha', '', 'password', 'autocomplete="current-password"')}${er}<button class="btn" type="submit">Entrar</button></form>
        <button class="pn-link-btn" type="button" data-login="esqueci">Esqueci minha senha</button>`,
      primeira: `<p>Olá, <b>${esc(convidado && convidado.nome)}</b>! Este é o seu primeiro acesso como <b>${esc(convidado && convidado.papel)}</b>. Crie a sua senha.</p>
        <form data-form="primeira">${camposSenha()}${er}<button class="btn" type="submit">Criar minha senha e entrar</button></form>`,
      esqueciDona: `<p>Como você é a dona da loja, dá para criar uma senha nova agora. As outras pessoas da equipe continuam com as delas.</p>
        <form data-form="redefinir">${campo('Seu usuário', 'usuario', '', 'text', 'autocomplete="username" required maxlength="40"')}${camposSenha('Nova senha (mínimo 6 letras ou números)')}${er}<button class="btn" type="submit">Criar senha nova e entrar</button></form>
        <button class="pn-link-btn" type="button" data-login="lembrei">Lembrei a senha</button>`,
      esqueci: `<p>Peça para a dona da loja entrar no painel, abrir a aba <b>Equipe</b> e liberar uma senha nova para você.</p><button class="pn-link-btn" type="button" data-login="lembrei">Voltar</button>`,
      /* site hospedado (Supabase): cada pessoa entra com o próprio e-mail */
      nEntrar: `<p>Entre com o seu e-mail e a senha do painel.</p>
        <form data-form="n-entrar">${campo('E-mail', 'email', '', 'email', 'autocomplete="email" required')}${campo('Senha', 'senha', '', 'password', 'autocomplete="current-password" required')}${er}<button class="btn" type="submit">Entrar</button></form>
        <button class="pn-link-btn" type="button" data-login="n-primeira">Primeiro acesso? Criar minha senha</button>
        <button class="pn-link-btn" type="button" data-login="n-esqueci">Esqueci minha senha</button>`,
      nPrimeira: `<p>Use o e-mail que a dona da loja colocou na equipe e crie a sua senha.</p>
        <form data-form="n-criar">${campo('E-mail', 'email', '', 'email', 'autocomplete="email" required')}${camposSenha()}${er}<button class="btn" type="submit">Criar minha senha</button></form>
        <button class="pn-link-btn" type="button" data-login="n-voltar">Já tenho senha</button>`,
      nEsqueci: `<p>Escreva o seu e-mail. Vamos mandar um link para você criar uma senha nova.</p>
        <form data-form="n-esqueci">${campo('E-mail', 'email', '', 'email', 'autocomplete="email" required')}${er}<button class="btn" type="submit">Mandar o link</button></form>
        <button class="pn-link-btn" type="button" data-login="n-voltar">Voltar</button>`,
      nEnviado: `<p>${esc(erro)}</p><button class="pn-link-btn" type="button" data-login="n-voltar">Voltar para o login</button>`,
      nNova: `<p>Crie a sua senha nova do painel.</p>
        <form data-form="n-nova">${camposSenha('Nova senha (mínimo 6 letras ou números)')}${er}<button class="btn" type="submit">Salvar e entrar</button></form>`,
      nFora: `<p>O e-mail <b>${esc(erro)}</b> ainda não faz parte da equipe. Peça para a dona da loja colocar esse e-mail na aba <b>Equipe</b> do painel.</p>
        <button class="btn" type="button" data-login="n-sair">Entrar com outro e-mail</button>`
    };
    if (NUVEM) telas.erro = `<p>Não consegui falar com o banco da loja agora. Confira a internet e tente de novo.</p><button class="btn" type="button" data-login="tentar">Tentar de novo</button>`;
    telaLogin.innerHTML = topo + telas[modo] + rodape;
    if (!telaLogin.open) telaLogin.showModal();
    const primeiro = $('input', telaLogin); if (primeiro) primeiro.focus();
  }
  async function pedirLogin(qual) {
    depoisDoLogin = qual || null;
    desenharLogin('carregando');
    await pronto;
    if (NUVEM) return entrarNaNuvem();
    if (!db) return desenharLogin('erro');
    try { desenharLogin((await lerEquipe()) ? 'entrar' : 'criar'); } catch (e) { desenharLogin('erro'); }
  }
  /* hospedado: quem já entrou neste aparelho segue direto; senão, tela de e-mail e senha */
  async function entrarNaNuvem(erro = '') {
    if (NUVEM.conta.recuperando()) return desenharLogin('nNova');
    const p = await NUVEM.conta.pessoa();
    if (p && p.foraDaEquipe) return desenharLogin('nFora', p.email);
    if (p) return liberar(p.chave, p);
    desenharLogin('nEntrar', erro);
  }
  const MSG_NUVEM = { 'Invalid login credentials': 'E-mail ou senha não conferem.', 'Email not confirmed': 'Falta confirmar o seu e-mail: abra o link que mandamos para ele.', 'User already registered': 'Esse e-mail já tem senha. Entre com ela ou use "Esqueci minha senha".' };
  const erroNuvem = er => MSG_NUVEM[er && er.message] || (er && /rate|limit/i.test(er.message) ? 'Muitas tentativas seguidas. Espere alguns minutos.' : 'Não deu certo agora. Tente de novo em instantes.');
  async function loginNuvem(modo, o) {
    const email = String(o.email || '').trim().toLowerCase();
    try {
      if (modo === 'n-entrar') {
        if (Date.now() < bloqueadoAte) return desenharLogin('nEntrar', 'Muitas tentativas. Espere ' + Math.ceil((bloqueadoAte - Date.now()) / 1000) + ' segundos.');
        await NUVEM.conta.entrar(email, o.senha); tentativas = 0; return entrarNaNuvem();
      }
      if (modo === 'n-criar') {
        if (!validarSenha(o, 'nPrimeira')) return;
        const r = await NUVEM.conta.criar(email, o.senha);
        if (r && r.session) return entrarNaNuvem();
        return desenharLogin('nEnviado', 'Pronto! Mandamos um e-mail para ' + email + '. Abra o link desse e-mail para confirmar; ele traz você de volta ao painel.');
      }
      if (modo === 'n-esqueci') { await NUVEM.conta.esqueci(email); return desenharLogin('nEnviado', 'Se ' + email + ' tiver acesso ao painel, chega um link nesse e-mail para criar uma senha nova.'); }
      if (modo === 'n-nova') { if (!validarSenha(o, 'nNova')) return; await NUVEM.conta.novaSenha(o.senha); avisar('Senha nova salva!'); return entrarNaNuvem(); }
    } catch (er) {
      if (modo === 'n-entrar' && ++tentativas >= 5) { bloqueadoAte = Date.now() + 30000; tentativas = 0; }
      desenharLogin({ 'n-entrar': 'nEntrar', 'n-criar': 'nPrimeira', 'n-esqueci': 'nEsqueci', 'n-nova': 'nNova' }[modo], erroNuvem(er));
    }
  }
  function liberar(chave, p) {
    try { sessionStorage.setItem(SESSAO, JSON.stringify({ usuario: chave, nome: p.nome, papel: p.papel })); } catch (e) {}
    tentativas = 0; convidado = null; telaLogin.close();
    if (!depoisDoLogin && p.papel === 'Gerente geral') depoisDoLogin = 'financeiro';
    abrir(depoisDoLogin);
  }
  function validarSenha(o, modo) {
    if (o.senha.length < 6) { desenharLogin(modo, 'A senha precisa ter pelo menos 6 caracteres.'); return false; }
    if (o.senha !== o.repete) { desenharLogin(modo, 'As duas senhas não são iguais.'); return false; }
    return true;
  }
  telaLogin.addEventListener('submit', async e => {
    e.preventDefault(); const f = e.target, o = ler(f), botao = $('[type=submit]', f);
    botao.disabled = true;
    try {
      const modo = f.dataset.form;
      if (NUVEM && modo.startsWith('n-')) return await loginNuvem(modo, o);
      if (modo === 'criar') {
        const k = chaveDe(o.usuario); if (!k) return desenharLogin('criar', 'Escolha um nome de usuário (letras e números).');
        if (!validarSenha(o, 'criar')) return;
        if (await lerEquipe()) return desenharLogin('entrar', 'Já existe uma senha. Entre com ela.');
        const eq = { [k]: await comSenha({ nome: capitalizar(o.usuario.trim()), papel: 'Dona' }, o.senha) };
        await gravarEquipe(eq); avisar('Senha criada! Guarde bem.'); return liberar(k, eq[k]);
      }
      if (modo === 'primeira') {
        if (!validarSenha(o, 'primeira')) return;
        const eq = await lerEquipe(), p = eq && eq[convidado.chave];
        if (!p || p.impressao) return desenharLogin('entrar', 'Esse usuário já tem senha. Entre com ela.');
        eq[convidado.chave] = await comSenha(p, o.senha); await gravarEquipe(eq); avisar('Senha criada! Bem-vindo à equipe.');
        return liberar(convidado.chave, eq[convidado.chave]);
      }
      if (modo === 'redefinir') {
        const dona = usuario ? await usuario.isOwner().catch(() => false) : false; if (!dona) return desenharLogin('esqueci');
        const k = chaveDe(o.usuario); if (!k) return desenharLogin('esqueciDona', 'Escreva o seu usuário.');
        if (!validarSenha(o, 'esqueciDona')) return;
        const eq = (await lerEquipe()) || {};
        eq[k] = await comSenha({ nome: (eq[k] && eq[k].nome) || capitalizar(o.usuario.trim()), papel: 'Dona' }, o.senha);
        await gravarEquipe(eq); avisar('Senha nova criada!'); return liberar(k, eq[k]);
      }
      if (Date.now() < bloqueadoAte) return desenharLogin('entrar', 'Muitas tentativas. Espere ' + Math.ceil((bloqueadoAte - Date.now()) / 1000) + ' segundos.');
      const eq = await lerEquipe(); if (!eq) return desenharLogin('criar');
      const k = chaveDe(o.usuario), p = eq[k];
      if (p && !p.impressao) { convidado = Object.assign({ chave: k }, p); return desenharLogin('primeira'); }
      if (p && await confere(o.senha, p)) return liberar(k, p);
      if (++tentativas >= 5) { bloqueadoAte = Date.now() + 30000; tentativas = 0; }
      desenharLogin('entrar', 'Usuário ou senha não conferem.');
    } catch (er) { desenharLogin('erro'); }
    finally { if (botao.isConnected) botao.disabled = false; }
  });
  telaLogin.addEventListener('click', async e => {
    const b = e.target.closest('[data-login]'); if (!b) return;
    const a = b.dataset.login;
    if (a === 'voltar') return telaLogin.close();
    if (a === 'tentar') return pedirLogin(depoisDoLogin);
    if (a === 'lembrei') return desenharLogin('entrar');
    if (a === 'n-primeira') return desenharLogin('nPrimeira');
    if (a === 'n-esqueci') return desenharLogin('nEsqueci');
    if (a === 'n-voltar') return desenharLogin('nEntrar');
    if (a === 'n-sair') { await NUVEM.conta.sair(); return desenharLogin('nEntrar'); }
    if (a === 'esqueci') { const dona = usuario ? await usuario.isOwner().catch(() => false) : false; return desenharLogin(dona ? 'esqueciDona' : 'esqueci'); }
  });
  telaLogin.addEventListener('cancel', e => { e.preventDefault(); telaLogin.close(); });
  function sairDoPainel() {
    if (aba === 'produtos' && editando) lerPeca();
    try { sessionStorage.removeItem(SESSAO); } catch (e) {}
    if (NUVEM) NUVEM.conta.sair();
    if (document.body.classList.contains('modo-edicao')) modoEdicao(false);
    aberto = false; if (dlg.open) dlg.close(); avisar('Você saiu do painel');
  }

  /* ---------- Equipe: quem entra no painel ---------- */
  const PAPEIS = ['Dona', 'Gerente geral', 'Gerente de marketing digital', 'Sócio(a)', 'Vendedor(a)', 'Ajudante'];
  let equipe = null, equipeErro = '';
  const ehDona = () => (quem() || {}).papel === 'Dona';
  function carregarEquipe() { if (!db) return; lerEquipe().then(eq => { equipe = eq || {}; equipeErro = ''; if (aberto && aba === 'equipe') desenhar(); }).catch(() => { equipeErro = 'Não consegui ler a equipe agora.'; if (aberto && aba === 'equipe') desenhar(); }); }
  telas.equipe = () => {
    if (!db) return `<h2>Equipe</h2><div class="pn-aviso">${esc(dbErro || 'Carregando…')}</div>`;
    if (!equipe) { carregarEquipe(); return `<h2>Equipe</h2>${equipeErro ? `<div class="pn-aviso">${esc(equipeErro)}</div>` : vazio('Carregando a equipe…')}`; }
    const eu = quem() || {}, temSantiago = !!equipe.santiago, pessoas = Object.entries(equipe);
    return `<h2>Equipe</h2><p class="pn-sub">Cada pessoa entra no painel com o próprio usuário e a própria senha. Na planilha compartilhada, aparece quem mexeu em cada linha.</p>
    <div class="pn-caixa pn-rolar"><table class="pn-tabela"><thead><tr><th>Nome</th><th>${NUVEM ? 'E-mail para entrar' : 'Usuário'}</th><th>Cargo</th><th>${NUVEM ? 'Acesso' : 'Senha'}</th><th></th></tr></thead><tbody>
    ${pessoas.map(([k, p]) => `<tr><td><b>${esc(p.nome)}</b>${k === eu.usuario ? ' <span class="pn-chip rosa">você</span>' : ''}</td><td>${!NUVEM ? esc(k)
      : ehDona() && k !== eu.usuario ? `<input type="email" data-email="${esc(k)}" value="${esc(p.email || '')}" placeholder="e-mail da pessoa" aria-label="E-mail de ${esc(p.nome)}">` : esc(p.email || '—')}</td><td>${ehDona() && k !== eu.usuario ? `<select data-cargo="${esc(k)}" aria-label="Cargo de ${esc(p.nome)}">${(PAPEIS.slice(1).includes(p.papel) ? PAPEIS.slice(1) : PAPEIS.slice(1).concat([p.papel])).map(x => `<option value="${esc(x)}"${x === p.papel ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>` : esc(p.papel)}</td>
      <td>${NUVEM ? (p.email ? '<span class="pn-chip ok">liberado</span>' : '<span class="pn-chip alerta">falta o e-mail</span>')
        : p.impressao ? '<span class="pn-chip ok">criada</span>' : '<span class="pn-chip alerta">esperando o 1º acesso</span>'}</td>
      <td>${ehDona() && k !== eu.usuario ? `${p.impressao && !NUVEM ? `<button class="pn-btn mini" type="button" data-liberar-senha="${esc(k)}">Liberar senha nova</button> ` : ''}<button class="pn-btn mini perigo" type="button" data-tirar-pessoa="${esc(k)}">Tirar</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>
    ${caixaConfirma('tirar-pessoa', 'Tirar essa pessoa da equipe? Ela não entra mais no painel.', 'Tirar')}
    ${ehDona() ? `<form class="pn-caixa pn-form" id="pn-form-pessoa" style="margin-top:16px"><h3>Adicionar pessoa</h3>
      <p class="pn-sub" style="margin:0">Você não precisa inventar a senha dela: no primeiro acesso, a própria pessoa cria a senha.</p>
      <div class="pn-campos">${campo('Nome', 'nome', temSantiago ? '' : 'Santiago')}${NUVEM ? campo('E-mail para entrar', 'email', '', 'email', 'required') : campo('Usuário para entrar', 'usuario', temSantiago ? '' : 'santiago', 'text', 'maxlength="40"')}
      ${selecao('Cargo', 'papel', temSantiago ? 'Sócio(a)' : 'Gerente geral', PAPEIS.slice(1).map(x => [x, x]))}</div>
      <div class="pn-acoes"><button class="pn-btn forte" type="submit">Adicionar à equipe</button></div></form>` : ''}
    <div class="pn-caixa" style="margin-top:16px"><h3>Como o Santiago entra no painel</h3><ol class="pn-sub" style="margin:0;padding-left:20px;display:grid;gap:6px">
      ${NUVEM ? `<li>Coloque o e-mail dele aqui na equipe.</li>
      <li>Mande para ele o link: <b>${esc(location.origin + location.pathname)}#painel</b></li>
      <li>Ele clica em <b>Primeiro acesso? Criar minha senha</b>, usa esse e-mail e confirma pelo link que chega no e-mail dele.</li></ol></div>` : `<li>No Claude, abra o site da loja e clique em <b>Compartilhar</b>. Convide o e-mail do Santiago como <b>Editor</b> (pode editar).</li>
      <li>Mande para ele o link: <b>${esc((R.loja.linkLoja || '').replace(/#.*$/, ''))}#painel</b></li>
      <li>Ele entra com o usuário <b>${esc(temSantiago ? 'santiago' : 'que você criar aqui')}</b> e cria a própria senha no primeiro acesso.</li></ol></div>`}
    <form class="pn-caixa pn-form" id="pn-form-minha-senha" style="margin-top:16px"><h3>Trocar a minha senha</h3><div class="pn-campos">
      ${campo('Senha atual', 'atual', '', 'password', 'autocomplete="current-password"')}${campo('Nova senha (mínimo 6)', 'nova', '', 'password', 'autocomplete="new-password" minlength="6"')}${campo('Repita a nova senha', 'repete', '', 'password', 'autocomplete="new-password" minlength="6"')}
    </div><div class="pn-acoes"><button class="pn-btn forte" type="submit">Trocar senha</button></div></form>`;
  };
  dlg.addEventListener('submit', async e => {
    const f = e.target; if (f.id !== 'pn-form-pessoa' && f.id !== 'pn-form-minha-senha') return;
    e.preventDefault(); e.stopImmediatePropagation(); const o = ler(f);
    try {
      const eq = (await lerEquipe()) || {};
      if (f.id === 'pn-form-pessoa') {
        if (!ehDona()) return;
        const k = chaveDe(o.usuario || o.nome); if (!o.nome.trim() || !k) { avisar('Preencha o nome e o usuário'); return; }
        if (eq[k]) { avisar('Já existe alguém com esse usuário'); return; }
        const email = String(o.email || '').trim().toLowerCase();
        if (NUVEM && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { avisar('Escreva um e-mail válido'); return; }
        if (NUVEM && Object.values(eq).some(p => String(p.email || '').toLowerCase() === email)) { avisar('Esse e-mail já está na equipe'); return; }
        eq[k] = Object.assign({ nome: o.nome.trim(), papel: o.papel }, NUVEM ? { email } : {}); await gravarEquipe(eq); equipe = eq;
        avisar(o.nome.trim() + ' foi adicionado(a) à equipe'); return desenhar();
      }
      const eu = quem(); if (!eu || !eq[eu.usuario]) return;
      if (o.nova.length < 6) { avisar('A nova senha precisa ter pelo menos 6 caracteres'); return; }
      if (o.nova !== o.repete) { avisar('As duas senhas novas não são iguais'); return; }
      if (NUVEM) {
        try { await NUVEM.conta.entrar(eq[eu.usuario].email, o.atual); } catch (er) { avisar('A senha atual não confere'); return; }
        await NUVEM.conta.novaSenha(o.nova); f.reset(); avisar('Senha trocada!'); return;
      }
      if (!(await confere(o.atual, eq[eu.usuario]))) { avisar('A senha atual não confere'); return; }
      eq[eu.usuario] = await comSenha(eq[eu.usuario], o.nova); await gravarEquipe(eq); equipe = eq; f.reset(); avisar('Senha trocada!');
    } catch (er) { avisar('Não consegui salvar agora. Tente de novo.'); }
  }, true);
  dlg.addEventListener('change', async e => {
    const t = e.target;
    if (t.matches('[data-email]')) {
      e.stopImmediatePropagation(); if (!ehDona()) return;
      const email = t.value.trim().toLowerCase();
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { avisar('Esse e-mail não parece certo'); return; }
      try { const eq = await lerEquipe(), k = t.dataset.email; if (!eq || !eq[k]) return; eq[k].email = email; await gravarEquipe(eq); equipe = eq; avisar(email ? 'E-mail de ' + eq[k].nome + ' salvo' : 'E-mail tirado'); desenhar(); }
      catch (er) { avisar('Não consegui salvar o e-mail agora.'); }
      return;
    }
    if (!t.matches('[data-cargo]')) return;
    e.stopImmediatePropagation(); if (!ehDona()) return;
    try { const eq = await lerEquipe(), k = t.dataset.cargo; if (!eq || !eq[k]) return; eq[k].papel = t.value; await gravarEquipe(eq); equipe = eq; avisar('Cargo de ' + eq[k].nome + ': ' + t.value); }
    catch (er) { avisar('Não consegui mudar o cargo agora.'); }
  }, true);
  let pessoaAlvo = null;
  dlg.addEventListener('click', async e => {
    const t = e.target.closest('[data-tirar-pessoa],[data-liberar-senha]'); if (!t || !ehDona()) return;
    e.stopImmediatePropagation();
    if (t.dataset.tirarPessoa) { pessoaAlvo = t.dataset.tirarPessoa; confirmar = 'tirar-pessoa'; return desenhar(); }
    try { const eq = await lerEquipe(), k = t.dataset.liberarSenha; const { sal, voltas, impressao: i, ...resto } = eq[k]; eq[k] = resto; await gravarEquipe(eq); equipe = eq; avisar(resto.nome + ' vai criar uma senha nova no próximo acesso'); desenhar(); }
    catch (er) { avisar('Não consegui agora.'); }
  }, true);
  dlg.addEventListener('click', async e => {
    const s = e.target.closest('[data-sim="tirar-pessoa"]'); if (!s) return;
    e.stopImmediatePropagation(); confirmar = null;
    try { const eq = await lerEquipe(); delete eq[pessoaAlvo]; await gravarEquipe(eq); equipe = eq; avisar('Pessoa tirada da equipe'); } catch (er) { avisar('Não consegui agora.'); }
    desenhar();
  }, true);

  /* ---------- Planilha compartilhada: várias abas, salva no cofre e sincronizada ao vivo ---------- */
  const MODELOS = {
    financeiro: ['Financeiro', [['Data', 'data'], ['Descrição', 'texto'], ['Entrada', 'moeda'], ['Saída', 'moeda'], ['Responsável', 'texto']]],
    compras: ['Compras', [['Data', 'data'], ['Fornecedor', 'texto'], ['Peças', 'texto'], ['Quantidade', 'numero'], ['Valor', 'moeda'], ['Situação', 'texto']]],
    tarefas: ['Tarefas', [['Tarefa', 'texto'], ['Responsável', 'texto'], ['Prazo', 'data'], ['Situação', 'texto']]],
    branco: ['Nova planilha', [['Coluna A', 'texto'], ['Coluna B', 'texto'], ['Coluna C', 'texto']]]
  };
  const TIPOS = [['texto', 'Texto'], ['numero', 'Número'], ['moeda', 'R$'], ['data', 'Data']];
  let focoPend = null, planilhas = null, planAtual = null, linhas = [], pararLinhas = null, planAssinada = false, esperaFoco = false, confirmaPlan = '';
  const idNovo = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function assinarPlanilhas() {
    if (planAssinada || !db) return; planAssinada = true;
    db.collection('planilhas').orderBy('criadoEm', 'asc').onSnapshot(snap => {
      planilhas = snap.docs.map(d => Object.assign({ _id: d.id }, d.data()));
      if (!planAtual || !planilhas.some(p => p._id === planAtual)) abrirPlanilha(planilhas[0] ? planilhas[0]._id : null);
      else redesenharPlanilha();
    }, () => { planilhas = []; redesenharPlanilha(); });
  }
  function abrirPlanilha(id) {
    if (pararLinhas) { pararLinhas(); pararLinhas = null; }
    planAtual = id; linhas = [];
    if (id) pararLinhas = db.collection('planilhas/' + id + '/linhas').orderBy('ordem', 'asc').onSnapshot(snap => {
      linhas = snap.docs.map(d => Object.assign({ _id: d.id }, d.data())); redesenharPlanilha();
    }, () => {});
    redesenharPlanilha();
  }
  /* não redesenha enquanto alguém está digitando numa célula: espera sair dela */
  function redesenharPlanilha() {
    if (!aberto || aba !== 'planilha') return;
    const digitando = () => main.contains(document.activeElement) && !!document.activeElement.closest('.pn-grade-plan');
    if (digitando()) {
      if (!esperaFoco) { esperaFoco = true; const ver = () => { if (!esperaFoco) return; if (digitando()) return setTimeout(ver, 300); esperaFoco = false; if (aberto && aba === 'planilha') desenhar(); }; setTimeout(ver, 300); }
      return;
    }
    esperaFoco = false; desenhar();
  }
  main.addEventListener('focusout', () => setTimeout(() => { if (esperaFoco && !(document.activeElement && document.activeElement.closest('.pn-grade-plan'))) { esperaFoco = false; desenhar(); } }, 0));
  const autor = () => { const q = quem() || {}; return (q.nome || 'Alguém') + (q.papel ? ' (' + q.papel + ')' : ''); };
  const quando = ms => { if (!ms) return ''; const d = new Date(ms); return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
  estilo.textContent += `.pn-abas-plan{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}
  .pn-grade-plan{border-collapse:separate;border-spacing:0;min-width:100%;font-size:.88rem}
  .pn-grade-plan th,.pn-grade-plan td{border-bottom:1px solid var(--linha);border-right:1px solid var(--linha);padding:0;vertical-align:middle}
  .pn-grade-plan th:first-child,.pn-grade-plan td:first-child{border-left:1px solid var(--linha)}
  .pn-grade-plan thead th{background:var(--nevoa);border-top:1px solid var(--linha);padding:6px;text-align:left}
  .pn-grade-plan thead th:first-child{border-top-left-radius:10px}.pn-grade-plan thead th:last-child{border-top-right-radius:10px}
  .pn-col{display:grid;gap:4px;min-width:130px}
  .pn-col input{font-weight:600;border:1px solid transparent;background:transparent;border-radius:6px;padding:4px 6px;font-size:.85rem}
  .pn-col input:hover,.pn-col input:focus{border-color:var(--linha);background:var(--papel)}
  .pn-col-linha{display:flex;gap:4px;align-items:center}.pn-col select{font-size:.75rem;border:1px solid var(--linha);border-radius:6px;background:var(--papel);padding:2px 4px}
  .pn-cel{width:100%;min-width:130px;height:38px;border:0;background:transparent;padding:0 10px;font-size:.88rem;color:var(--tinta)}
  .pn-cel:focus{outline:2px solid var(--ouro);outline-offset:-2px;background:var(--papel)}
  .pn-cel[type=number]{text-align:right;font-variant-numeric:tabular-nums}
  .pn-grade-plan tbody tr:hover td{background:color-mix(in srgb,var(--blush-claro) 40%,transparent)}
  .pn-grade-plan .pn-n{width:44px;min-width:44px;text-align:center;color:var(--tinta-suave);font-size:.75rem;background:var(--nevoa)}
  .pn-grade-plan tfoot td{background:var(--nevoa);padding:8px 10px;font-weight:600;font-variant-numeric:tabular-nums;text-align:right}
  .pn-x{border:0;background:none;color:var(--tinta-suave);cursor:pointer;width:30px;height:30px;border-radius:8px}.pn-x:hover{background:#F8DEDB;color:#9A3B32}
  .pn-nome-plan{font-weight:700;font-size:1.05rem;border:1px solid transparent;background:transparent;border-radius:8px;padding:6px 8px;min-width:0;flex:1;max-width:340px}
  .pn-nome-plan:hover,.pn-nome-plan:focus{border-color:var(--linha);background:var(--papel)}`;
  telas.planilha = () => {
    if (!db) return `<h2>Planilha compartilhada</h2><div class="pn-aviso">${esc(dbErro || 'Carregando…')}</div>`;
    assinarPlanilhas();
    const cab = `<h2>Planilha compartilhada</h2><p class="pn-sub">Uma planilha da equipe, salva no cofre do painel. O que você escreve aparece na hora para o Santiago, e o que ele escreve aparece para você. Clique numa célula e digite.</p>`;
    if (planilhas === null) return cab + vazio('Carregando as planilhas…');
    const novas = `<div class="pn-barra">${Object.entries(MODELOS).map(([k, m]) => `<button class="pn-btn mini" type="button" data-nova-plan="${k}">+ ${k === 'branco' ? 'Em branco' : m[0]}</button>`).join('')}</div>`;
    if (!planilhas.length) return cab + `<div class="pn-caixa pn-form"><h3>Comece por um modelo</h3><p class="pn-sub" style="margin:0">Financeiro (entradas e saídas), Compras (pedidos aos fornecedores), Tarefas (quem faz o quê) ou uma em branco.</p>${novas}</div>`;
    const p = planilhas.find(x => x._id === planAtual) || planilhas[0], cols = p.colunas || [];
    const ultima = linhas.reduce((m, l) => (l.editadoEm || 0) > (m.editadoEm || 0) ? l : m, { editadoEm: p.editadoEm || 0, editadoPor: p.editadoPor || '' });
    const valor = (l, c) => ((l.celulas || {})[c.id] ?? '');
    const total = c => linhas.reduce((a, l) => a + num(valor(l, c)), 0);
    return cab + `<div class="pn-abas-plan">${planilhas.map(x => `<button class="pn-btn mini${x._id === p._id ? ' forte' : ''}" type="button" data-plan="${esc(x._id)}">${esc(x.nome)}</button>`).join('')}
      <details style="display:inline-block"><summary class="pn-btn mini" style="list-style:none">+ Nova planilha</summary><div class="pn-barra" style="margin-top:8px">${Object.entries(MODELOS).map(([k, m]) => `<button class="pn-btn mini" type="button" data-nova-plan="${k}">${k === 'branco' ? 'Em branco' : m[0]}</button>`).join('')}</div></details></div>
    <div class="pn-caixa pn-form">
      <div class="pn-barra" style="margin:0"><input class="pn-nome-plan" id="pn-nome-plan" value="${esc(p.nome)}" aria-label="Nome da planilha">
        <button class="pn-btn mini forte" type="button" data-plan-acao="linha">+ Linha</button><button class="pn-btn mini" type="button" data-plan-acao="coluna">+ Coluna</button>
        <button class="pn-btn mini" type="button" data-plan-acao="copiar">Copiar para o Excel</button><button class="pn-btn mini perigo" type="button" data-plan-acao="apagar">Apagar planilha</button></div>
      ${confirmaPlan === 'apagar' ? `<div class="pn-confirma">Apagar a planilha "${esc(p.nome)}" inteira, com todas as linhas? Isso não pode ser desfeito.<button class="pn-btn mini perigo" type="button" data-plan-acao="apagar-sim">Apagar</button><button class="pn-btn mini" type="button" data-plan-acao="nao">Cancelar</button></div>` : ''}
      <div class="pn-rolar"><table class="pn-grade-plan"><thead><tr><th class="pn-n">#</th>
        ${cols.map(c => `<th><div class="pn-col"><input value="${esc(c.nome)}" data-col-nome="${esc(c.id)}" aria-label="Nome da coluna"><div class="pn-col-linha"><select data-col-tipo="${esc(c.id)}" aria-label="Tipo da coluna">${TIPOS.map(t => `<option value="${t[0]}"${c.tipo === t[0] ? ' selected' : ''}>${t[1]}</option>`).join('')}</select><button class="pn-x" type="button" data-tirar-col="${esc(c.id)}" title="Tirar coluna" aria-label="Tirar coluna ${esc(c.nome)}">✕</button></div></div></th>`).join('')}<th class="pn-n"></th></tr></thead>
        <tbody>${linhas.map((l, n) => `<tr title="${l.editadoPor ? 'Última alteração: ' + esc(l.editadoPor) + ' · ' + quando(l.editadoEm) : ''}"><td class="pn-n">${n + 1}</td>
          ${cols.map(c => `<td><input class="pn-cel" data-cel="${esc(l._id)}|${esc(c.id)}" value="${esc(valor(l, c))}" type="${c.tipo === 'data' ? 'date' : c.tipo === 'texto' ? 'text' : 'number'}"${c.tipo === 'moeda' ? ' step="0.01"' : c.tipo === 'numero' ? ' step="any"' : ''} aria-label="${esc(c.nome)}, linha ${n + 1}"></td>`).join('')}
          <td class="pn-n"><button class="pn-x" type="button" data-tirar-linha="${esc(l._id)}" aria-label="Tirar linha ${n + 1}">✕</button></td></tr>`).join('') || `<tr><td class="pn-n"></td><td colspan="${cols.length}" style="padding:14px">${vazio('Nenhuma linha ainda. Clique em "+ Linha".')}</td><td class="pn-n"></td></tr>`}</tbody>
        ${cols.some(c => c.tipo === 'moeda' || c.tipo === 'numero') && linhas.length ? `<tfoot><tr><td class="pn-n">Σ</td>${cols.map(c => `<td>${c.tipo === 'moeda' ? brl(total(c)) : c.tipo === 'numero' ? total(c).toLocaleString('pt-BR') : ''}</td>`).join('')}<td class="pn-n"></td></tr></tfoot>` : ''}
      </table></div>
      <p class="pn-sub" style="margin:0">${ultima.editadoPor ? 'Última alteração: <b>' + esc(ultima.editadoPor) + '</b> · ' + quando(ultima.editadoEm) : 'Ainda sem alterações.'} · ${linhas.length} ${linhas.length === 1 ? 'linha' : 'linhas'}</p>
    </div>`;
  };
  const refPlan = () => db.collection('planilhas').doc(planAtual);
  const colunasAtuais = () => clone((planilhas.find(x => x._id === planAtual) || {}).colunas || []);
  dlg.addEventListener('click', async e => {
    const t = e.target, el = s => t.closest(s);
    if (!el('[data-plan],[data-nova-plan],[data-plan-acao],[data-tirar-col],[data-tirar-linha]')) return;
    e.stopImmediatePropagation();
    try {
      if (el('[data-plan]')) { confirmaPlan = ''; return abrirPlanilha(el('[data-plan]').dataset.plan); }
      if (el('[data-nova-plan]')) {
        const m = MODELOS[el('[data-nova-plan]').dataset.novaPlan], id = idNovo();
        await db.collection('planilhas').doc(id).set({ nome: m[0], colunas: m[1].map(c => ({ id: idNovo(), nome: c[0], tipo: c[1] })), criadoEm: Date.now(), editadoPor: autor(), editadoEm: Date.now() });
        planAtual = id; abrirPlanilha(id); avisar('Planilha criada'); return;
      }
      if (el('[data-tirar-linha]')) { await db.collection('planilhas/' + planAtual + '/linhas').doc(el('[data-tirar-linha]').dataset.tirarLinha).delete(); return; }
      if (el('[data-tirar-col]')) { const cs = colunasAtuais().filter(c => c.id !== el('[data-tirar-col]').dataset.tirarCol); await refPlan().update({ colunas: cs, editadoPor: autor(), editadoEm: Date.now() }); return; }
      const a = el('[data-plan-acao]').dataset.planAcao;
      if (a === 'linha') { const ordem = linhas.length ? Math.max(...linhas.map(l => num(l.ordem))) + 1 : 1; await db.collection('planilhas/' + planAtual + '/linhas').doc(idNovo()).set({ celulas: {}, ordem, editadoPor: autor(), editadoEm: Date.now() }); return; }
      if (a === 'coluna') { const cs = colunasAtuais(); cs.push({ id: idNovo(), nome: 'Coluna ' + String.fromCharCode(65 + cs.length % 26), tipo: 'texto' }); await refPlan().update({ colunas: cs, editadoPor: autor(), editadoEm: Date.now() }); return; }
      if (a === 'copiar') {
        const cs = colunasAtuais(), txt = [cs.map(c => c.nome).join('\t')].concat(linhas.map(l => cs.map(c => String(((l.celulas || {})[c.id]) ?? '').replace(/[\t\n]/g, ' ')).join('\t'))).join('\n');
        try { await navigator.clipboard.writeText(txt); avisar('Copiado! Cole no Excel ou no Google Planilhas.'); } catch (er) { avisar('Não consegui copiar automaticamente neste navegador.'); }
        return;
      }
      if (a === 'apagar') { confirmaPlan = 'apagar'; return desenhar(); }
      if (a === 'nao') { confirmaPlan = ''; return desenhar(); }
      if (a === 'apagar-sim') {
        confirmaPlan = ''; const id = planAtual, ls = linhas.slice();
        for (const l of ls) await db.collection('planilhas/' + id + '/linhas').doc(l._id).delete();
        await db.collection('planilhas').doc(id).delete(); avisar('Planilha apagada'); return;
      }
    } catch (er) { avisar('Não consegui salvar na planilha agora. Tente de novo.'); }
  }, true);
  dlg.addEventListener('change', async e => {
    const t = e.target; if (!t.matches('[data-cel],[data-col-nome],[data-col-tipo],#pn-nome-plan')) return;
    e.stopImmediatePropagation();
    try {
      if (t.id === 'pn-nome-plan') { await refPlan().update({ nome: t.value.trim() || 'Planilha', editadoPor: autor(), editadoEm: Date.now() }); return; }
      if (t.dataset.colNome || t.dataset.colTipo) {
        const cs = colunasAtuais(), c = cs.find(x => x.id === (t.dataset.colNome || t.dataset.colTipo)); if (!c) return;
        if (t.dataset.colNome) c.nome = t.value.trim() || c.nome; else c.tipo = t.value;
        await refPlan().update({ colunas: cs, editadoPor: autor(), editadoEm: Date.now() }); return;
      }
      const [lid, cid] = t.dataset.cel.split('|'), l = linhas.find(x => x._id === lid); if (!l) return;
      const cel = Object.assign({}, l.celulas || {}); cel[cid] = t.type === 'number' ? (t.value === '' ? '' : num(t.value)) : t.value;
      await db.collection('planilhas/' + planAtual + '/linhas').doc(lid).update({ celulas: cel, editadoPor: autor(), editadoEm: Date.now() });
    } catch (er) { avisar('Não consegui salvar essa célula. Tente de novo.'); }
  }, true);
  /* Enter desce para a célula de baixo, como numa planilha */
  dlg.addEventListener('keydown', e => {
    const t = e.target; if (e.key !== 'Enter' || !t.matches('[data-cel]')) return;
    e.preventDefault(); const td = t.closest('td'), tr = td.parentElement, i = Array.from(tr.children).indexOf(td), prox = tr.nextElementSibling;
    const alvo = prox && prox.children[i] && $('input', prox.children[i]); focoPend = alvo ? alvo.dataset.cel : null; t.blur();
    setTimeout(() => { if (focoPend) { const a = main.querySelector('[data-cel="' + focoPend + '"]'); focoPend = null; if (a) a.focus(); } }, 40);
  });

  /* ---------- Financeiro: receita dos pedidos + lançamentos da equipe, com gráficos mês a mês ---------- */
  const CATEGORIAS = ['Compra de mercadoria', 'Frete e envio', 'Embalagem', 'Marketing e anúncios', 'Taxas e impostos', 'Comissões', 'Fotos e conteúdo', 'Aluguel e contas', 'Outras despesas'];
  const RECEBIDO = ['pago', 'enviado', 'entregue'];
  let lancamentos = null, finAssinado = false, finPeriodo = '6', finForm = null;
  function assinarFinanceiro() {
    if (finAssinado || !db) return; finAssinado = true;
    db.collection('financeiro').orderBy('data', 'desc').onSnapshot(snap => {
      lancamentos = snap.docs.map(d => Object.assign({ _id: d.id }, d.data())); if (aberto && aba === 'financeiro') desenhar();
    }, () => { lancamentos = []; if (aberto && aba === 'financeiro') desenhar(); });
  }
  const mesDe = d => String(d || '').slice(0, 7);
  const nomeMes = m => { const [a, n] = m.split('-'); return ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][+n - 1] + '/' + a.slice(2); };
  function mesesAte(n) { const r = [], d = new Date(); d.setDate(1); for (let i = n - 1; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); r.push(x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0')); } return r; }
  /* barras de uma série só; aceita valores negativos (lucro) com a linha do zero no meio */
  function barras(rotulos, valores, dicas, cor) {
    const W = 360, H = 200, e = 46, b = 24, mx = Math.max(...valores, 0), mn = Math.min(...valores, 0);
    if (!mx && !mn) return vazio('Ainda não há valores neste período.');
    const passo = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000].find(s => s * 4 >= mx - mn) || Math.ceil((mx - mn) / 4);
    const topo = Math.ceil(mx / passo) * passo, base = Math.floor(mn / passo) * passo, alt = H - b - 10;
    const y = v => 10 + (topo - v) / ((topo - base) || 1) * alt, larg = (W - e - 4) / rotulos.length, zero = y(0);
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de barras">`;
    for (let v = base; v <= topo; v += passo) { const yy = y(v); svg += `<line x1="${e}" x2="${W}" y1="${yy}" y2="${yy}" stroke="var(--linha)" stroke-width="1"/><text x="${e - 6}" y="${yy + 4}" text-anchor="end" font-size="11" fill="var(--tinta-suave)">${Math.abs(v) >= 1000 ? (v / 1000).toLocaleString('pt-BR') + 'k' : v}</text>`; }
    valores.forEach((v, i) => {
      const w = Math.min(34, larg * .62), x = e + i * larg + (larg - w) / 2, yy = y(v), h = Math.abs(zero - yy), r = Math.min(4, w / 2, h);
      if (h > 0) svg += v >= 0
        ? `<path d="M${x},${zero}V${yy + r}Q${x},${yy} ${x + r},${yy}H${x + w - r}Q${x + w},${yy} ${x + w},${yy + r}V${zero}Z" fill="${cor}"/>`
        : `<path d="M${x},${zero}V${yy - r}Q${x},${yy} ${x + r},${yy}H${x + w - r}Q${x + w},${yy} ${x + w},${yy - r}V${zero}Z" fill="#B4483F"/>`;
      svg += `<rect x="${e + i * larg}" y="0" width="${larg}" height="${H - b}" fill="transparent" data-tip="${esc(dicas[i])}"/>`;
      if (rotulos.length <= 6 || (rotulos.length - 1 - i) % 2 === 0) svg += `<text x="${e + i * larg + larg / 2}" y="${H - 7}" text-anchor="middle" font-size="11" fill="var(--tinta-suave)">${esc(rotulos[i])}</text>`;
    });
    if (mn < 0) svg += `<line x1="${e}" x2="${W}" y1="${zero}" y2="${zero}" stroke="var(--tinta-suave)" stroke-width="1"/>`;
    return `<div class="pn-grafico">${svg}</svg><div class="pn-dica"></div></div>`;
  }
  function numerosDoPeriodo(meses) {
    const dentro = d => meses.includes(mesDe(d));
    const peds = pedidos.filter(p => p.status !== 'cancelado' && dentro(p.data));
    const recebidos = peds.filter(p => RECEBIDO.includes(p.status)), aReceber = peds.filter(p => p.status === 'novo');
    const lanc = (lancamentos || []).filter(l => dentro(l.data));
    const porMes = meses.map(m => {
      const pm = recebidos.filter(p => mesDe(p.data) === m), lm = lanc.filter(l => mesDe(l.data) === m);
      const receita = pm.reduce((a, p) => a + num(p.total), 0) + lm.filter(l => l.tipo === 'entrada').reduce((a, l) => a + num(l.valor), 0);
      const comissao = pm.reduce((a, p) => a + (p.afiliado ? num(p.total) * num((parceiros[p.afiliado] || {}).comissao) / 100 : 0), 0);
      const despesas = lm.filter(l => l.tipo === 'saida').reduce((a, l) => a + num(l.valor), 0) + comissao;
      return { m, receita, despesas, lucro: receita - despesas, pedidos: pm.length };
    });
    const soma = k => porMes.reduce((a, x) => a + x[k], 0);
    const descontos = recebidos.reduce((a, p) => a + num(p.desconto), 0);
    const comissoes = recebidos.reduce((a, p) => a + (p.afiliado ? num(p.total) * num((parceiros[p.afiliado] || {}).comissao) / 100 : 0), 0);
    const porCat = {}; lanc.filter(l => l.tipo === 'saida').forEach(l => { porCat[l.categoria || 'Outras despesas'] = (porCat[l.categoria || 'Outras despesas'] || 0) + num(l.valor); });
    if (comissoes) porCat['Comissões de afiliadas'] = (porCat['Comissões de afiliadas'] || 0) + comissoes;
    const entradasExtras = lanc.filter(l => l.tipo === 'entrada').reduce((a, l) => a + num(l.valor), 0);
    return { porMes, receita: soma('receita'), despesas: soma('despesas'), lucro: soma('lucro'), aReceber: aReceber.reduce((a, p) => a + num(p.total), 0), qtdAReceber: aReceber.length,
      vendas: recebidos.reduce((a, p) => a + num(p.total), 0), bruto: recebidos.reduce((a, p) => a + num(p.subtotal || p.total), 0), descontos, comissoes, entradasExtras, porCat, lanc };
  }
  telas.financeiro = () => {
    if (!db) return `<h2>Financeiro</h2><div class="pn-aviso">${esc(dbErro || 'Carregando o cofre…')}</div>`;
    assinarFinanceiro();
    if (finForm) return telaLancamento();
    const n = finPeriodo === '12' ? 12 : finPeriodo === '3' ? 3 : finPeriodo === '1' ? 1 : 6, meses = mesesAte(n), f = numerosDoPeriodo(meses);
    const margem = f.receita ? f.lucro / f.receita * 100 : 0;
    const cats = Object.entries(f.porCat).sort((a, b) => b[1] - a[1]), maxCat = cats.length ? cats[0][1] : 0;
    const linhaDRE = (rot, v, forte, sinal = '') => `<tr${forte ? ' style="font-weight:700"' : ''}><td>${rot}</td><td style="text-align:right;font-variant-numeric:tabular-nums">${sinal}${brl(Math.abs(v))}</td></tr>`;
    return `<h2>Financeiro</h2>
    <p class="pn-sub">A receita vem sozinha dos pedidos <b>pagos, enviados ou entregues</b> da aba Pedidos. As despesas e outras entradas vocês registram aqui em <b>Lançamentos</b>. As comissões das afiliadas entram sozinhas como despesa.</p>
    <div class="pn-barra">${[['1', 'Este mês'], ['3', '3 meses'], ['6', '6 meses'], ['12', '12 meses']].map(o => `<button class="pn-btn mini${finPeriodo === o[0] ? ' forte' : ''}" type="button" data-fin-periodo="${o[0]}">${o[1]}</button>`).join('')}
      <button class="pn-btn forte" type="button" data-fin="novo-saida" style="margin-left:auto">+ Despesa</button><button class="pn-btn" type="button" data-fin="novo-entrada">+ Entrada</button></div>
    <div class="pn-grade pn-g4">
      <div class="pn-caixa pn-tile"><small>Receita</small><b>${brl(f.receita)}</b><span>vendas e entradas recebidas</span></div>
      <div class="pn-caixa pn-tile"><small>Despesas</small><b>${brl(f.despesas)}</b><span>lançamentos e comissões</span></div>
      <div class="pn-caixa pn-tile"><small>Lucro</small><b style="color:${f.lucro < 0 ? '#9A3B32' : 'inherit'}">${f.lucro < 0 ? '− ' : ''}${brl(Math.abs(f.lucro))}</b><span>margem de ${margem.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span></div>
      <div class="pn-caixa pn-tile"><small>A receber</small><b>${brl(f.aReceber)}</b><span>${f.qtdAReceber} ${f.qtdAReceber === 1 ? 'pedido esperando' : 'pedidos esperando'} pagamento</span></div>
    </div>
    <div class="pn-grade pn-g2" style="margin-top:16px">
      <div class="pn-caixa"><h3>Receita por mês</h3>${barras(f.porMes.map(x => nomeMes(x.m)), f.porMes.map(x => x.receita), f.porMes.map(x => nomeMes(x.m) + ' · receita ' + brl(x.receita) + ' · ' + x.pedidos + (x.pedidos === 1 ? ' pedido' : ' pedidos')), 'var(--rosa)')}</div>
      <div class="pn-caixa"><h3>Despesas por mês</h3>${barras(f.porMes.map(x => nomeMes(x.m)), f.porMes.map(x => x.despesas), f.porMes.map(x => nomeMes(x.m) + ' · despesas ' + brl(x.despesas)), 'var(--tinta-suave)')}</div>
      <div class="pn-caixa"><h3>Lucro por mês</h3>${barras(f.porMes.map(x => nomeMes(x.m)), f.porMes.map(x => x.lucro), f.porMes.map(x => nomeMes(x.m) + ' · lucro ' + (x.lucro < 0 ? '− ' : '') + brl(Math.abs(x.lucro))), '#3F7F58')}<p class="pn-vazio" style="padding:6px 0 0">Barras abaixo da linha do zero, em vermelho, são meses de prejuízo.</p></div>
      <div class="pn-caixa"><h3>Despesas por categoria</h3>${cats.length ? `<ul class="pn-lista">${cats.map(([k, v]) => `<li style="display:grid;grid-template-columns:1fr auto;gap:4px 10px"><span>${esc(k)}</span><span>${brl(v)}</span><span style="grid-column:1/-1;height:8px;border-radius:4px;background:var(--nevoa);overflow:hidden"><span style="display:block;height:100%;width:${(v / maxCat * 100).toFixed(1)}%;background:var(--tinta-suave);border-radius:4px"></span></span></li>`).join('')}</ul>` : vazio('Nenhuma despesa registrada neste período.')}</div>
    </div>
    <div class="pn-grade pn-g2" style="margin-top:16px">
      <div class="pn-caixa"><h3>Resultado do período</h3><table class="pn-tabela"><tbody>
        ${linhaDRE('Vendas (antes dos descontos)', f.bruto)}${f.descontos ? linhaDRE('(−) Descontos de cupons', f.descontos, false, '− ') : ''}${f.entradasExtras ? linhaDRE('(+) Outras entradas', f.entradasExtras, false, '+ ') : ''}
        ${linhaDRE('= Receita', f.receita, true)}
        ${cats.map(([k, v]) => linhaDRE('(−) ' + esc(k), v, false, '− ')).join('')}
        ${linhaDRE('= Lucro', f.lucro, true, f.lucro < 0 ? '− ' : '')}
      </tbody></table></div>
      <div class="pn-caixa"><h3>Lançamentos do período</h3>${f.lanc.length ? `<div class="pn-rolar"><table class="pn-tabela"><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th style="text-align:right">Valor</th></tr></thead><tbody>
        ${f.lanc.map(l => `<tr class="clicavel" data-lanc="${esc(l._id)}" title="${l.autor ? 'Lançado por ' + esc(l.autor) : ''}"><td>${dataBR(l.data)}</td><td>${esc(l.descricao || '—')}</td><td>${l.tipo === 'entrada' ? '<span class="pn-chip ok">entrada</span>' : esc(l.categoria || '')}</td><td style="text-align:right;font-variant-numeric:tabular-nums;color:${l.tipo === 'entrada' ? '#3F7F58' : 'inherit'}">${l.tipo === 'entrada' ? '+ ' : '− '}${brl(l.valor)}</td></tr>`).join('')}
        </tbody></table></div>` : vazio('Nenhum lançamento neste período. Registre as compras de mercadoria, fretes e outras despesas em "+ Despesa".')}
        <div class="pn-acoes" style="margin-top:10px"><button class="pn-btn mini" type="button" data-fin="copiar">Copiar para o Excel</button></div></div>
    </div>`;
  };
  function telaLancamento() {
    const l = finForm, novo = !l._id, entrada = l.tipo === 'entrada';
    return `<h2>${novo ? (entrada ? 'Nova entrada' : 'Nova despesa') : 'Editar lançamento'}</h2>
    <p class="pn-sub">${entrada ? 'Dinheiro que entrou fora dos pedidos do site, como uma venda na loja física ou um aporte.' : 'Tudo o que saiu do caixa: compra de mercadoria, frete, embalagem, anúncios…'}</p>
    <form class="pn-caixa pn-form" id="pn-form-lanc"><div class="pn-campos">
      ${campo('Data', 'data', l.data, 'date')}${campo('Valor (R$)', 'valor', l.valor, 'number', 'min="0" step="0.01" required')}
      ${entrada ? '' : selecao('Categoria', 'categoria', l.categoria, CATEGORIAS.map(x => [x, x]))}
      ${campo('Descrição', 'descricao', l.descricao, 'text', 'largo maxlength="120"')}
    </div>
    ${caixaConfirma('apagar-lanc', 'Apagar este lançamento?', 'Apagar')}
    <div class="pn-acoes">${novo ? '' : '<button class="pn-btn perigo" type="button" data-fin="apagar">Apagar</button>'}<button class="pn-btn" type="button" data-fin="voltar">Voltar</button><button class="pn-btn forte" type="submit">Salvar</button></div></form>`;
  }
  dlg.addEventListener('click', async e => {
    const t = e.target, el = s => t.closest(s);
    if (!el('[data-fin],[data-fin-periodo],[data-lanc],[data-sim="apagar-lanc"]')) return;
    e.stopImmediatePropagation();
    if (el('[data-fin-periodo]')) { finPeriodo = el('[data-fin-periodo]').dataset.finPeriodo; return desenhar(); }
    if (el('[data-lanc]')) { const l = (lancamentos || []).find(x => x._id === el('[data-lanc]').dataset.lanc); if (l) { finForm = clone(l); main.scrollTop = 0; desenhar(); } return; }
    if (el('[data-sim="apagar-lanc"]')) { confirmar = null; try { await db.collection('financeiro').doc(finForm._id).delete(); finForm = null; avisar('Lançamento apagado'); } catch (er) { avisar('Não consegui apagar agora.'); } return desenhar(); }
    const a = el('[data-fin]').dataset.fin;
    if (a === 'novo-saida' || a === 'novo-entrada') { finForm = { tipo: a === 'novo-entrada' ? 'entrada' : 'saida', data: hoje(), valor: '', categoria: CATEGORIAS[0], descricao: '' }; main.scrollTop = 0; return desenhar(); }
    if (a === 'voltar') { finForm = null; confirmar = null; return desenhar(); }
    if (a === 'apagar') { confirmar = 'apagar-lanc'; return desenhar(); }
    if (a === 'copiar') {
      const n = finPeriodo === '12' ? 12 : finPeriodo === '3' ? 3 : finPeriodo === '1' ? 1 : 6, f = numerosDoPeriodo(mesesAte(n));
      const txt = ['Mês\tReceita\tDespesas\tLucro'].concat(f.porMes.map(x => [nomeMes(x.m), x.receita, x.despesas, x.lucro].map(v => typeof v === 'number' ? v.toFixed(2).replace('.', ',') : v).join('\t')))
        .concat(['', 'Data\tTipo\tCategoria\tDescrição\tValor']).concat(f.lanc.map(l => [dataBR(l.data), l.tipo === 'entrada' ? 'Entrada' : 'Despesa', l.categoria || '', (l.descricao || '').replace(/\t/g, ' '), num(l.valor).toFixed(2).replace('.', ',')].join('\t'))).join('\n');
      try { await navigator.clipboard.writeText(txt); avisar('Copiado! Cole no Excel ou no Google Planilhas.'); } catch (er) { avisar('Não consegui copiar automaticamente neste navegador.'); }
    }
  }, true);
  dlg.addEventListener('submit', async e => {
    if (e.target.id !== 'pn-form-lanc') return;
    e.preventDefault(); e.stopImmediatePropagation();
    const o = ler(e.target), valor = Math.round(num(o.valor) * 100) / 100;
    if (!(valor > 0)) { avisar('Coloque um valor maior que zero'); return; }
    const corpo = { tipo: finForm.tipo, data: o.data || hoje(), valor, categoria: finForm.tipo === 'entrada' ? '' : o.categoria, descricao: o.descricao.trim(), autor: autor(), criadoEm: finForm.criadoEm || Date.now() };
    try {
      if (finForm._id) await db.collection('financeiro').doc(finForm._id).set(corpo); else await db.collection('financeiro').add(corpo);
      avisar(finForm.tipo === 'entrada' ? 'Entrada registrada' : 'Despesa registrada'); finForm = null; desenhar();
    } catch (er) { avisar('Não consegui salvar agora. Tente de novo.'); }
  }, true);

  /* ---------- Etiquetas: código de 5 números + código de barras (Code 128), com pré-visualização antes de baixar o arquivo de impressão ---------- */
  let codigos = null, downloads = null, formatoEtiqueta = 'tag', textoEtiqueta = 'nome', previaEtq = null;
  usar('downloads').then(d => { downloads = d; });
  const codigosRef = () => db.collection('configuracao').doc('codigos');
  async function carregarCodigos() { if (codigos || !db) return codigos; try { const s = await codigosRef().get(); codigos = (s.exists && s.data().mapa) || {}; } catch (e) { codigos = codigos || {}; } return codigos; }
  pronto.then(() => carregarCodigos().then(() => { if (aberto && aba === 'produtos') desenhar(); }));
  const chaveVar = (p, t, c) => p.id + '|' + t + '|' + c;
  const codigoDe = (p, t, c) => (codigos || {})[chaveVar(p, t, c)] || '';
  const refDe = p => p.referencia != null && p.referencia !== '' ? p.referencia : ((/(\d{4,6}(?:-[a-z])?)$/i.exec(p.id) || [])[1] || '');
  async function garantirCodigos(p) {
    await carregarCodigos(); const s = await codigosRef().get(), atual = (s.exists && s.data().mapa) || {};
    const usados = new Set(Object.values(atual)); let novos = 0;
    p.tamanhos.forEach(t => p.cores.forEach(c => {
      const k = chaveVar(p, t, c); if (atual[k]) return;
      let cod; do { cod = String(10000 + Math.floor(Math.random() * 90000)); } while (usados.has(cod));
      usados.add(cod); atual[k] = cod; novos++;
    }));
    if (novos) await codigosRef().set({ mapa: atual, atualizadoEm: Date.now() });
    codigos = atual; return atual;
  }
  const pecaPorCodigo = cod => { const k = Object.keys(codigos || {}).find(x => codigos[x] === cod); return k ? { id: k.split('|')[0], tam: k.split('|')[1], cor: k.split('|').slice(2).join('|') } : null; };

  /* Code 128 (conjunto B): larguras de barra/espaço de cada símbolo, do 0 ao 106 */
  const C128 = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112').split(' ');
  function barrasCode128(texto) {
    const vals = [104].concat(Array.from(String(texto)).map(ch => ch.charCodeAt(0) - 32));
    const soma = vals.reduce((a, v, i) => a + v * (i || 1), 0) % 103;
    const seq = vals.concat([soma, 106]).map(v => C128[v]).join('');
    let x = 10, rects = '';
    for (let i = 0; i < seq.length; i++) { const w = +seq[i]; if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${w}" height="40"/>`; x += w; }
    return `<svg class="cb" viewBox="0 0 ${x + 10} 40" preserveAspectRatio="none" aria-label="Código de barras ${esc(texto)}">${rects}</svg>`;
  }
  const textoPrincipal = e => textoEtiqueta === 'ref' ? (e.ref ? 'Ref. ' + e.ref : e.nome) : e.nome;
  const linhaRef = e => textoEtiqueta === 'ambos' && e.ref ? `<div class="r">Ref. ${esc(e.ref)}</div>` : '';
  /* tamanhos em mm; "folha" = sai em A4 para recortar, senão uma etiqueta por página (impressora de etiqueta) */
  const FORMATOS = {
    tag: { nome: 'Tag de roupa · 35 × 50 mm (folha A4 para recortar, 25 por folha)', w: 35, h: 50, cols: 5, porFolha: 25, folha: true, vertical: true },
    mini: { nome: 'Etiqueta pequena · 40 × 25 mm (impressora térmica)', w: 40, h: 25, folha: false },
    a4: { nome: 'Etiqueta adesiva · 63,5 × 33,9 mm (folha A4, 24 por folha)', w: 63.5, h: 33.9, cols: 3, porFolha: 24, folha: true },
    rolo: { nome: 'Etiqueta de rolo · 50 × 30 mm (impressora térmica)', w: 50, h: 30, folha: false }
  };
  const etiquetaHTML = (e, formato) => FORMATOS[formato].vertical
    ? `<div class="e v-tag"><span class="furo"></span><div class="m">CABIDINO</div><div class="n">${esc(textoPrincipal(e))}</div>${linhaRef(e)}
      <div class="v">Tam. <b>${esc(e.tam)}</b></div><div class="v">${esc(capitalizar(e.cor))}</div><div class="p">${esc(brl(e.preco))}</div>
      ${barrasCode128(e.codigo)}<div class="c">${esc(e.codigo)}</div></div>`
    : `<div class="e"><div class="t"><span class="m">CABIDINO</span><span class="p">${esc(brl(e.preco))}</span></div>
      <div class="n">${esc(textoPrincipal(e))}</div>${linhaRef(e)}<div class="v">Tam. ${esc(e.tam)} · ${esc(capitalizar(e.cor))}</div>
      ${barrasCode128(e.codigo)}<div class="c">${esc(e.codigo)}</div></div>`;
  function cssEtiquetas(formato, s = '') {
    const F = FORMATOS[formato], pequena = F.h <= 25, k = pequena ? .8 : F.w >= 60 ? 1.1 : 1;
    const pt = n => (n * k).toFixed(1) + 'pt';
    return `${s}.folha{display:grid;grid-template-columns:repeat(${F.folha ? F.cols : 1},${F.w}mm);grid-auto-rows:${F.h}mm;gap:${F.folha ? (F.vertical ? '2mm' : '0 2.5mm') : '3mm'};font-family:"Segoe UI",Arial,sans-serif;color:#3b302d}
    ${s}.e{box-sizing:border-box;background:#fff;padding:${pequena ? '1.3mm 2mm' : '2.2mm 3mm'};display:flex;flex-direction:column;overflow:hidden;border:0.2mm dashed #cfc4bf;position:relative}
    ${s}.t{display:flex;justify-content:space-between;align-items:baseline;gap:2mm}
    ${s}.m{font-family:Georgia,"Times New Roman",serif;letter-spacing:.22em;font-size:${pt(6)};color:#9A505C}
    ${s}.p{font-size:${pt(7.5)};font-weight:700;white-space:nowrap}
    ${s}.n{font-weight:700;font-size:${pt(7.5)};line-height:1.15;margin-top:.4mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    ${s}.r{font-size:${pt(6)};color:#6d5f5a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    ${s}.v{font-size:${pt(6.5)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    ${s}.cb{display:block;width:100%;height:${pequena ? '6.5mm' : '8mm'};margin-top:auto;fill:#000}
    ${s}.c{text-align:center;font-family:Consolas,"Courier New",monospace;font-weight:700;font-size:${pt(8)};letter-spacing:.25em;line-height:1.1}
    ${s}.v-tag{align-items:center;text-align:center;padding:7mm 2.2mm 2mm}
    ${s}.v-tag .furo{position:absolute;top:2.2mm;left:50%;width:3mm;height:3mm;margin-left:-1.5mm;border:0.25mm solid #b9aca6;border-radius:50%}
    ${s}.v-tag .m{font-size:6.5pt;margin-bottom:1mm}
    ${s}.v-tag .n{font-size:7.5pt;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;width:100%}
    ${s}.v-tag .r,${s}.v-tag .v{width:100%;font-size:6.5pt}
    ${s}.v-tag .p{font-size:10pt;margin-top:1mm}
    ${s}.v-tag .cb{height:7.5mm}`;
  }
  function htmlEtiquetas(lista, formato) {
    const F = FORMATOS[formato];
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Etiquetas Cabidino</title><style>
      @page{size:${F.folha ? 'A4' : F.w + 'mm ' + F.h + 'mm'};margin:${F.folha ? (F.vertical ? '10mm 9mm' : '13mm 7mm') : '0'}}body{margin:0}
      ${cssEtiquetas(formato)}
      ${F.folha ? '' : '.folha{gap:0}.e{page-break-after:always;border:0}'}
      .aviso{font-family:"Segoe UI",Arial,sans-serif;padding:16px;font-size:14px;background:#FBE3DF;color:#9A505C}@media print{.aviso{display:none}${F.vertical ? '' : '.e{border-color:transparent}'}}
      </style></head><body><div class="aviso">${lista.length} ${lista.length === 1 ? 'etiqueta' : 'etiquetas'} da Cabidino. A janela de impressão abre sozinha; se não abrir, aperte Ctrl + P. Na impressão, deixe a escala em 100% (tamanho real).${F.vertical ? ' As linhas tracejadas são para recortar.' : ''}</div>
      <div class="folha">${lista.map(e => etiquetaHTML(e, formato)).join('')}</div><script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script></body></html>`;
  }
  Object.keys(FORMATOS).forEach(f => { estilo.textContent += cssEtiquetas(f, '.pn-previa.f-' + f + ' '); });
  estilo.textContent += `
    .pn-previa{background:#ECE6E2;border-radius:14px;padding:16px;overflow:auto;max-height:520px}
    .pn-previa .folha{background:#fff;padding:6mm;width:max-content;margin:0 auto;box-shadow:0 6px 18px -10px rgba(0,0,0,.35)}
    .pn-previa.f-rolo .folha,.pn-previa.f-mini .folha{grid-template-columns:repeat(5,max-content);gap:3mm;background:transparent;box-shadow:none;padding:0}
    .pn-previa.f-rolo .e,.pn-previa.f-mini .e{border:0.2mm solid #d8cfca;border-radius:1.5mm}`;

  function listaDoFormulario(p) {
    const form = $('#pn-form-peca', dlg); const lista = [];
    $$('[data-etq]', form).forEach(i => {
      const n = Math.max(0, Math.min(200, Math.round(num(i.value)))), [t, ...c] = i.dataset.etq.split('|'), cor = c.join('|');
      for (let k = 0; k < n; k++) lista.push({ nome: nomeCompleto(p), ref: refDe(p), tam: t, cor, preco: precoDe(p), codigo: codigoDe(p, t, cor) || '00000' });
    });
    return lista;
  }
  function secaoEtiquetas(p) {
    const est = p.estoque || {}, pv = previaEtq && previaEtq.id === p.id ? previaEtq : null;
    const Fp = pv && FORMATOS[pv.formato], nf = Fp && Fp.folha ? Math.ceil(pv.lista.length / Fp.porFolha) : 0;
    const folhas = pv ? (Fp.folha ? nf + (nf === 1 ? ' folha A4' : ' folhas A4') : 'uma por vez na impressora de etiqueta') : '';
    return `<div class="pn-form"><h3 style="margin:0">Etiquetas para imprimir</h3>
      <p class="pn-sub" style="margin:0">Escolha quantas etiquetas de cada tamanho e cor (já vem com a quantidade do estoque). Os códigos de 5 números e de barras são criados sozinhos e não mudam mais.</p>
      <div class="pn-rolar"><table class="pn-estoque"><thead><tr><th>Tam.</th>${p.cores.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>
      ${p.tamanhos.map(t => `<tr><th>${t}</th>${p.cores.map(c => { const cod = codigoDe(p, t, c); return `<td><input type="number" min="0" max="200" data-etq="${esc(t + '|' + c)}" value="${pv ? pv.qtd[t + '|' + c] || 0 : num(est[t + '|' + c])}" aria-label="Etiquetas tamanho ${t}, ${esc(c)}"><div style="font-size:.72rem;color:var(--tinta-suave);margin-top:2px;font-variant-numeric:tabular-nums">${cod ? 'cód. ' + cod : 'novo código'}</div></td>`; }).join('')}</tr>`).join('')}
      </tbody></table></div>
      <div class="pn-campos">
        ${selecao('Escrever na etiqueta', 'texto-etq', textoEtiqueta, [['nome', 'Nome da peça'], ['ref', 'Referência da roupa' + (refDe(p) ? ' (Ref. ' + refDe(p) + ')' : '')], ['ambos', 'Nome e referência']])}
        ${selecao('Modelo de etiqueta', 'formato-etq', formatoEtiqueta, Object.entries(FORMATOS).map(([k, x]) => [k, x.nome]))}
      </div>
      <div class="pn-acoes" style="justify-content:flex-start"><button class="pn-btn forte" type="button" data-acao="previa-etq">👀 Pré-visualizar etiquetas</button></div>
      ${pv ? `<div class="pn-form"><p class="pn-sub" style="margin:0"><b>Pré-visualização:</b> ${pv.lista.length} ${pv.lista.length === 1 ? 'etiqueta' : 'etiquetas'} · ${folhas}${pv.lista.length > 50 ? ' · mostrando as 50 primeiras' : ''}. Confira o texto, o tamanho, a cor e o preço.</p>
        <div class="pn-previa f-${pv.formato}"><div class="folha">${pv.lista.slice(0, 50).map(e => etiquetaHTML(e, pv.formato)).join('')}</div></div>
        <div class="pn-acoes" style="justify-content:flex-start"><button class="pn-btn forte" type="button" data-acao="imprimir-etq">🖨️ Está certo, baixar para imprimir</button><button class="pn-btn" type="button" data-acao="fechar-previa">Fechar pré-visualização</button></div></div>` : ''}
    </div>`;
  }
  async function previaEtiquetas() {
    const form = $('#pn-form-peca', dlg), p = porId(editando); if (!form || !p) return;
    lerPeca();
    formatoEtiqueta = $('[name="formato-etq"]', form).value; textoEtiqueta = $('[name="texto-etq"]', form).value;
    const qtd = {}; $$('[data-etq]', form).forEach(i => { qtd[i.dataset.etq] = Math.max(0, Math.min(200, Math.round(num(i.value)))); });
    if (!Object.values(qtd).some(n => n > 0)) { avisar('Coloque a quantidade de etiquetas em pelo menos um tamanho'); return; }
    if (!db) { avisar('Os códigos ficam no cofre do painel, que não abriu agora.'); return; }
    try { await garantirCodigos(p); } catch (e) { avisar('Não consegui criar os códigos agora. Tente de novo.'); return; }
    previaEtq = { id: p.id, formato: formatoEtiqueta, qtd, lista: [] }; desenhar();
    previaEtq.lista = listaDoFormulario(p); desenhar();
    const area = $('.pn-previa', dlg); if (area) area.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  async function imprimirEtiquetas() {
    const p = porId(editando); if (!p || !previaEtq || previaEtq.id !== p.id) return;
    if (!downloads) { avisar('Baixar o arquivo de etiquetas não está liberado nesta tela.'); return; }
    try {
      await downloads.save({ filename: 'etiquetas-' + slug(textoEtiqueta === 'ref' && refDe(p) ? 'ref-' + refDe(p) : p.nome) + '.html', data: htmlEtiquetas(previaEtq.lista, previaEtq.formato) });
      avisar('Arquivo baixado! Abra o arquivo para imprimir as ' + previaEtq.lista.length + ' etiquetas.');
    } catch (e) {
      const c = e && e.code;
      avisar(c === 'declined' ? 'Download cancelado.' : c === 'rate_limited' ? 'Espere um instante e tente de novo.' : 'Não consegui gerar as etiquetas agora. Tente de novo.');
    }
  }
  dlg.addEventListener('click', e => {
    const b = e.target.closest('[data-acao="previa-etq"],[data-acao="imprimir-etq"],[data-acao="fechar-previa"]'); if (!b) return;
    e.stopImmediatePropagation();
    if (b.dataset.acao === 'previa-etq') previaEtiquetas();
    else if (b.dataset.acao === 'imprimir-etq') imprimirEtiquetas();
    else { previaEtq = null; desenhar(); }
  }, true);
  dlg.addEventListener('change', e => {
    if (!e.target.matches('[data-etq],[name="formato-etq"],[name="texto-etq"]')) return;
    e.stopImmediatePropagation();
    if (e.target.name === 'formato-etq') formatoEtiqueta = e.target.value;
    if (e.target.name === 'texto-etq') textoEtiqueta = e.target.value;
    if (previaEtq) previaEtiquetas();
  }, true);

  /* ---------- Abrir e fechar ---------- */
  function abrir(qual) {
    if (!logado()) return pedirLogin(qual);
    if (document.body.classList.contains('modo-edicao')) modoEdicao(false);
    if (qual && telas[qual]) aba = qual;
    aberto = true; if (!dlg.open) dlg.showModal(); desenhar();
    pronto.then(() => { if (aberto) desenhar(); });
  }
  function fechar() {
    if (aba === 'produtos' && editando) lerPeca();
    aberto = false; dlg.close();
    if (mudou()) avisar('Suas alterações estão guardadas no rascunho. Publique quando quiser.');
  }
  window.PainelCabidino = { abrir };
})();
