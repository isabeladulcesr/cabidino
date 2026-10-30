/* =====================================================================
   NUVEM DA CABIDINO (Supabase)
   Usado só quando o site está hospedado fora do Claude (GitHub + Netlify).
   Oferece ao site e ao painel as mesmas peças que o Claude oferece:
   - db: coleções e documentos (pedidos, financeiro, planilhas...), ao vivo
   - publicar o catálogo, enviar fotos, baixar arquivos
   - login da equipe com e-mail e senha
   A proteção de verdade está no banco (regras do arquivo 1-estrutura.sql).
   ===================================================================== */
(function () {
  var C = window.CABIDINO_CONFIG || {};
  var configurado = !!(C.supabaseUrl && C.supabaseChave && !/COLE_AQUI/.test(C.supabaseUrl + C.supabaseChave));
  if (!configurado || !window.supabase) { window.CABIDINO_NUVEM = null; return; }

  var sb = window.supabase.createClient(C.supabaseUrl, C.supabaseChave);
  var TABELA = 'documentos';
  var linkPainel = function () { return location.origin + location.pathname + '#painel'; };

  /* ---------- Atualização ao vivo: qualquer mudança faz as listas abertas lerem de novo ---------- */
  var ouvintes = [], espera;
  function reler() { clearTimeout(espera); espera = setTimeout(function () { ouvintes.slice().forEach(function (f) { f(); }); }, 150); }
  sb.channel('cabidino-documentos').on('postgres_changes', { event: '*', schema: 'public', table: TABELA }, reler).subscribe();

  var aoRecuperar = [], recuperando = false;
  sb.auth.onAuthStateChange(function (ev) {
    if (ev === 'PASSWORD_RECOVERY') { recuperando = true; aoRecuperar.forEach(function (f) { f(); }); }
    if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') { pessoaGuardada = null; reler(); }
  });

  var falhou = function (r) { if (r.error) throw r.error; return r.data; };
  var novoId = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); };

  /* ---------- db: mesmo jeito de usar do banco do Claude ---------- */
  function documento(colecao, id) {
    var d = {
      id: id,
      get: function () {
        return sb.from(TABELA).select('dados').eq('colecao', colecao).eq('id', id).maybeSingle().then(falhou).then(function (l) {
          return { id: id, exists: !!l, data: function () { return l ? l.dados : undefined; } };
        });
      },
      set: function (dados) {
        return sb.from(TABELA).upsert({ colecao: colecao, id: id, dados: JSON.parse(JSON.stringify(dados)), atualizado_em: new Date().toISOString() })
          .then(falhou).then(function () { reler(); });
      },
      update: function (campos) {
        return d.get().then(function (s) {
          if (!s.exists) throw { code: 'not_found' };
          return d.set(Object.assign({}, s.data(), campos));
        });
      },
      delete: function () {
        return sb.from(TABELA).delete().eq('colecao', colecao).eq('id', id).then(falhou).then(function () { reler(); });
      }
    };
    return d;
  }
  function colecao(caminho, ordem) {
    function buscar() {
      return sb.from(TABELA).select('id,dados').eq('colecao', caminho).then(falhou).then(function (ls) {
        if (ordem) ls.sort(function (a, b) {
          var x = a.dados[ordem.campo], y = b.dados[ordem.campo];
          var r = x == null ? -1 : y == null ? 1 : x < y ? -1 : x > y ? 1 : 0;
          return ordem.desc ? -r : r;
        });
        return { docs: ls.map(function (l) { return { id: l.id, exists: true, data: function () { return l.dados; } }; }) };
      });
    }
    return {
      orderBy: function (campo, dir) { return colecao(caminho, { campo: campo, desc: dir === 'desc' }); },
      doc: function (id) { return documento(caminho, id); },
      add: function (dados) { var id = novoId(); return documento(caminho, id).set(dados).then(function () { return { id: id }; }); },
      get: buscar,
      onSnapshot: function (cb, erro) {
        var vivo = true;
        var ler = function () { buscar().then(function (s) { if (vivo) cb(s); }, function (e) { if (vivo && erro) erro(e); }); };
        ouvintes.push(ler); ler();
        return function () { vivo = false; ouvintes = ouvintes.filter(function (f) { return f !== ler; }); };
      }
    };
  }
  var db = { collection: function (caminho) { return colecao(caminho); } };

  /* ---------- Equipe: quem é a pessoa logada ---------- */
  var pessoaGuardada = null;
  function pessoa() {
    if (pessoaGuardada) return pessoaGuardada;
    pessoaGuardada = sb.auth.getSession().then(function (r) {
      var s = r.data && r.data.session; if (!s) return null;
      var email = String(s.user.email || '').toLowerCase();
      return documento('configuracao', 'acesso').get().then(function (d) {
        var us = (d.exists && d.data().usuarios) || {};
        var k = Object.keys(us).filter(function (k) { return String(us[k].email || '').toLowerCase() === email; })[0];
        return k ? { chave: k, nome: us[k].nome, papel: us[k].papel, email: email } : { foraDaEquipe: true, email: email };
      });
    }).catch(function () { pessoaGuardada = null; return null; });
    return pessoaGuardada;
  }

  /* ---------- Login ---------- */
  var conta = {
    entrar: function (email, senha) { return sb.auth.signInWithPassword({ email: email, password: senha }).then(falhou).then(function (d) { pessoaGuardada = null; return d; }); },
    criar: function (email, senha) { return sb.auth.signUp({ email: email, password: senha, options: { emailRedirectTo: linkPainel() } }).then(falhou).then(function (d) { pessoaGuardada = null; return d; }); },
    esqueci: function (email) { return sb.auth.resetPasswordForEmail(email, { redirectTo: linkPainel() }).then(falhou); },
    novaSenha: function (senha) { recuperando = false; return sb.auth.updateUser({ password: senha }).then(falhou); },
    sair: function () { pessoaGuardada = null; return sb.auth.signOut().catch(function () {}); },
    pessoa: pessoa,
    recuperando: function () { return recuperando; },
    aoRecuperar: function (f) { aoRecuperar.push(f); if (recuperando) f(); },
    /* o link do e-mail (confirmação ou senha nova) volta para o site com o acesso no endereço */
    veioDoEmail: /access_token=|type=(signup|recovery|magiclink)/.test(location.hash) || /[?&]code=/.test(location.search)
  };

  /* ---------- Catálogo, fotos e arquivos ---------- */
  function lerLoja(reserva) {
    var tempo = new Promise(function (ok) { setTimeout(function () { ok(null); }, 4000); });
    var busca = sb.from('loja').select('dados').eq('id', 1).maybeSingle().then(falhou).then(function (l) { return l && l.dados; }).catch(function () { return null; });
    return Promise.race([busca, tempo]).then(function (d) { return d || reserva; });
  }
  function salvarLoja(dados) {
    return sb.from('loja').upsert({ id: 1, dados: JSON.parse(JSON.stringify(dados)), atualizado_em: new Date().toISOString() }).then(falhou);
  }
  var assets = {
    upload: function (blob) {
      var nome = 'pecas/' + novoId() + '.jpg';
      return sb.storage.from('fotos').upload(nome, blob, { contentType: blob.type || 'image/jpeg', upsert: false }).then(falhou).then(function () {
        return { url: sb.storage.from('fotos').getPublicUrl(nome).data.publicUrl };
      });
    }
  };
  var downloads = {
    save: function (o) {
      var url = URL.createObjectURL(new Blob([o.data], { type: 'text/html;charset=utf-8' }));
      var a = document.createElement('a'); a.href = url; a.download = o.filename || 'arquivo.html';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      return Promise.resolve();
    }
  };

  window.CABIDINO_NUVEM = {
    db: db, assets: assets, downloads: downloads, conta: conta,
    lerLoja: lerLoja, salvarLoja: salvarLoja,
    /* para o botão "Painel" do topo: só aparece para quem já está logado e é da equipe */
    ehEquipe: function () { return pessoa().then(function (p) { return !!(p && !p.foraDaEquipe); }); }
  };
})();
