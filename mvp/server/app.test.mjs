import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataType, newDb } from 'pg-mem';
import { abrirBanco, criarServidorApi, provisionarCAMInicial } from './app.mjs';

let db;
let server;
let baseUrl;
let cam;
let logger;
const camEmail = 'admin@example.test';
const camPasswordInitial = 'InitialCam2026!Strong';
let camPassword;

beforeEach(async () => {
  const memory = newDb();
  memory.public.registerFunction({
    name: 'pg_get_serial_sequence',
    args: [DataType.text, DataType.text],
    returns: DataType.regclass,
    implementation: (table, column) => `${table}_${column}_seq`,
  });
  const { Pool } = memory.adapters.createPg();
  db = await abrirBanco({ pool: new Pool(), configurarAuditoria: false });
  camPassword = camPasswordInitial;
  await provisionarCAMInicial(db, { email: camEmail, senha: camPasswordInitial });
  logger = { info: vi.fn() };
  server = criarServidorApi(db, { logger });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  cam = await login(camEmail, camPasswordInitial);
  const novaSenhaCam = 'InitialCam2026!StrongChanged';
  await requisitar('/api/auth/password', {
    sessao: cam, metodo: 'POST',
    corpo: { senhaAtual: camPasswordInitial, novaSenha: novaSenhaCam },
  });
  camPassword = novaSenhaCam;
  cam.user.deveTrocarSenha = false;
});

afterEach(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await db.close();
});

async function requisitar(caminho, { sessao, metodo = 'GET', corpo, csrf = true, headers = {} } = {}) {
  const resposta = await fetch(`${baseUrl}${caminho}`, {
    method: metodo,
    headers: {
      ...(corpo === undefined ? {} : { 'content-type': 'application/json' }),
      ...(sessao ? { cookie: sessao.cookie, ...(csrf ? { 'x-csrf-token': sessao.csrfToken } : {}) } : {}),
      ...headers,
    },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
  });
  let body = {};
  try { body = await resposta.json(); } catch { /* resposta vazia de teste */ }
  return { status: resposta.status, body, headers: resposta.headers };
}

async function login(email, senha) {
  const resposta = await requisitar('/api/auth/login', { metodo: 'POST', corpo: { email, senha } });
  if (resposta.status !== 200) throw new Error(`Login de teste falhou: ${JSON.stringify(resposta.body)}`);
  return {
    cookie: resposta.headers.get('set-cookie').split(';')[0],
    csrfToken: resposta.body.csrfToken,
    user: resposta.body.user,
  };
}

async function loginComSenhaPessoal(email, senha) {
  const sessao = await login(email, senha);
  if (sessao.user.deveTrocarSenha) {
    const senhaPessoal = 'MyPrivate2026!Updated';
    const resposta = await requisitar('/api/auth/password', {
      sessao, metodo: 'POST', corpo: { senhaAtual: senha, novaSenha: senhaPessoal },
    });
    expect(resposta.status).toBe(200);
    sessao.user.deveTrocarSenha = false;
    sessao.senha = senhaPessoal;
  }
  return sessao;
}

async function criarUnidade({ nome = 'Unidade de Teste', tipo = 'USF', distrito = 'DS I' } = {}) {
  const resposta = await requisitar('/api/unidades', { sessao: cam, metodo: 'POST', corpo: { nome, tipo, distrito } });
  expect(resposta.status).toBe(201);
  return resposta.body.unidades.find(item => item.nome === nome);
}

function camposValidos(unidadeId) {
  const indicadorIds = unidadeId.tipo === 'CAPS'
    ? ['1.1', '2.1', '2.2', '2.3', '2.4', '3.1', '3.2', '4.C1', '4.C2', '4.C3', '4.C4', '4.C5']
    : ['1.1', '2.1', '2.2', '2.3', '2.4', '3.1', '3.2',
      '4.1.1', '4.1.2', '4.1.3', '4.1.4', '4.1.5', '4.1.6',
      '4.1.7', '4.1.8', '4.1.9', '4.1.10', '4.1.11'];
  return Object.fromEntries(indicadorIds.map(id => [id, id === '2.2' ? { n: '0', d: '10' } : { n: '8', d: '10' }]));
}

async function criarConta({ nome, email, senha = 'StrongUser2026!Pass', perfil = 'usf', unidadeId, distrito } = {}) {
  return requisitar('/api/usuarios', {
    sessao: cam, metodo: 'POST',
    corpo: { nome: nome ?? 'Pessoa Teste', email: email ?? 'user@example.test', senha, perfil, unidadeId, distrito },
  });
}

describe('Autenticação e persistência GratificAI', () => {
  it('não permite selecionar perfil pelo cliente nem consultar estado sem sessão', async () => {
    expect((await requisitar('/api/state', { headers: { 'x-user-profile': 'cam' } })).status).toBe(401);
    const anonima = await requisitar('/api/auth/session');
    expect(anonima.status).toBe(200);
    expect(anonima.body.user).toBeNull();
    const impersonacao = await requisitar('/api/state', { sessao: cam, headers: { 'x-user-profile': 'usf' } });
    expect(impersonacao.status).toBe(200);
    expect(impersonacao.body.user.perfil).toBe('cam');
    expect(impersonacao.body.unidades).toEqual([]);
  });

  it('valida credenciais, usa cookie HttpOnly e bloqueia tentativas repetidas', async () => {
    const negado = await requisitar('/api/auth/login', { metodo: 'POST', corpo: { email: camEmail, senha: 'senha-incorreta' } });
    expect(negado.status).toBe(401);
    const senhaExcessiva = await requisitar('/api/auth/login', {
      metodo: 'POST', corpo: { email: camEmail, senha: 'X'.repeat(257) },
    });
    expect(senhaExcessiva.status).toBe(401);
    const emailExcessivo = await requisitar('/api/auth/login', {
      metodo: 'POST', corpo: { email: `${'x'.repeat(255)}@example.test`, senha: 'wrong' },
    });
    expect(emailExcessivo.status).toBe(401);
    expect((await criarConta({ email: `${'x'.repeat(255)}@example.test` })).status).toBe(400);
    const loginCorreto = await requisitar('/api/auth/login', { metodo: 'POST', corpo: { email: camEmail, senha: camPassword } });
    expect(loginCorreto.status).toBe(200);
    expect(loginCorreto.headers.get('set-cookie')).toContain('HttpOnly');
    expect(loginCorreto.headers.get('set-cookie')).toContain('SameSite=Strict');
    expect(loginCorreto.body.user.perfil).toBe('cam');

    const email = 'blocked@example.test';
    for (let attempt = 0; attempt < 5; attempt++) {
      await requisitar('/api/auth/login', { metodo: 'POST', corpo: { email, senha: 'wrong' } });
    }
    expect((await requisitar('/api/auth/login', { metodo: 'POST', corpo: { email, senha: 'wrong' } })).status).toBe(429);
  });

  it('registra acessos sem incluir IDs específicos, credenciais ou dados enviados', async () => {
    logger.info.mockClear();
    const resposta = await requisitar('/api/unidades/123/draft', {
      metodo: 'POST', corpo: { campos: { pessoal: 'não deve ir ao log' }, senha: 'Secret2026!' },
    });
    expect(resposta.status).toBe(401);
    const registro = logger.info.mock.calls
      .map(([mensagem]) => JSON.parse(mensagem))
      .find(item => item.event === 'api_access');
    expect(registro).toMatchObject({
      method: 'POST',
      route: '/api/unidades/:id/draft',
      status: 401,
    });
    expect(JSON.stringify(registro)).not.toContain('123');
    expect(JSON.stringify(registro)).not.toContain('Secret2026!');
    expect(JSON.stringify(registro)).not.toContain('não deve ir ao log');
  });

  it('exige token CSRF nas operações de escrita', async () => {
    const resposta = await requisitar('/api/unidades', { sessao: cam, metodo: 'POST', csrf: false, corpo: { nome: 'X', tipo: 'USF', distrito: 'DS I' } });
    expect(resposta.status).toBe(403);
    const origemNegada = await requisitar('/api/unidades', {
      sessao: cam, metodo: 'POST',
      headers: { origin: 'https://origem-nao-confiavel.example' },
      corpo: { nome: 'X', tipo: 'USF', distrito: 'DS I' },
    });
    expect(origemNegada.status).toBe(403);
  });

  it('rejeita origens HTTP ou com caminho quando configurado para produção', () => {
    const nodeEnvAnterior = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => criarServidorApi(db, { allowedOrigins: ['http://example.test'] }))
        .toThrow('Em produção, configure somente origens HTTPS válidas em APP_ORIGIN.');
      expect(() => criarServidorApi(db, { allowedOrigins: ['https://example.test/app'] }))
        .toThrow('Em produção, configure somente origens HTTPS válidas em APP_ORIGIN.');
    } finally {
      if (nodeEnvAnterior === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnvAnterior;
    }
  });

  it('cria escopos de distrito/unidade e aplica autorização no servidor', async () => {
    const usf = await criarUnidade();
    const segundaUnidade = await criarUnidade({ nome: 'Outra Unidade', distrito: 'DS II' });
    const conta = await criarConta({ unidadeId: usf.id });
    expect(conta.status).toBe(201);
    const unitUser = await loginComSenhaPessoal('user@example.test', 'StrongUser2026!Pass');
    const estado = await requisitar('/api/state', { sessao: unitUser });
    expect(estado.body.unidades.map(item => item.id)).toEqual([usf.id]);

    const negado = await requisitar(`/api/unidades/${segundaUnidade.id}/draft`, {
      sessao: unitUser, metodo: 'POST', corpo: { campos: {}, justificativas: {} },
    });
    expect(negado.status).toBe(403);

    const distrital = await criarConta({ email: 'district@example.test', perfil: 'gg', distrito: 'DS I' });
    expect(distrital.status).toBe(201);
    const districtUser = await loginComSenhaPessoal('district@example.test', 'StrongUser2026!Pass');
    const estadoDistrito = await requisitar('/api/state', { sessao: districtUser });
    expect(estadoDistrito.body.user.distrito).toBe('DS I');
    expect(estadoDistrito.body.unidades.map(item => item.id)).toEqual([usf.id]);
  });

  it('persiste lançamentos e atualiza o histórico de aprendizado', async () => {
    const unidade = await criarUnidade();
    const conta = await criarConta({ unidadeId: unidade.id });
    expect(conta.status).toBe(201);
    const user = await loginComSenhaPessoal('user@example.test', 'StrongUser2026!Pass');
    const campos = camposValidos(unidade);
    const justificativas = { '2.2': 'Conferência na folha confirmou que não houve abonos irregulares.' };
    const inserirHistorico = db.prepare(`
      INSERT INTO historico (unidade_id, sub_id, valor, submetido_em, aprovado)
      VALUES (?, '4.1.1', 80, ?, 1)
    `);
    for (let observacao = 0; observacao < 11; observacao++) {
      await inserirHistorico.run(unidade.id, `2024-01-${String(observacao + 1).padStart(2, '0')}T00:00:00.000Z`);
    }
    const enviado = await requisitar(`/api/unidades/${unidade.id}/submit`, { sessao: user, metodo: 'POST', corpo: { campos, justificativas } });
    expect(enviado.status).toBe(200);
    expect(enviado.body.enviadas[unidade.id]).toBe(true);
    expect(enviado.body.unidades.find(item => item.id === unidade.id))
      .toMatchObject({ nota: 76, gratificacaoEsperada: 3648, notaCompleta: true });
    expect(await db.prepare('SELECT perfil_lancamento FROM lancamentos WHERE unidade_id = ?').get(unidade.id))
      .toEqual({ perfil_lancamento: 'usf' });
    const auditoriaLancamento = await db.prepare("SELECT detalhes FROM auditoria WHERE acao = 'lancamento_submetido'").get();
    expect(auditoriaLancamento.detalhes).not.toContain(justificativas['2.2']);
    expect(Number((await db.prepare('SELECT COUNT(*) AS total FROM historico WHERE unidade_id = ? AND aprovado = 1').get(unidade.id)).total)).toBe(11);
    expect((await requisitar(`/api/unidades/${unidade.id}/review`, {
      sessao: cam, metodo: 'POST', corpo: { decisao: 'approve' },
    })).status).toBe(200);
    expect(Number((await db.prepare('SELECT COUNT(*) AS total FROM historico WHERE unidade_id = ? AND aprovado = 1').get(unidade.id)).total)).toBeGreaterThan(11);

    const discrepantes = { ...campos, '4.1.1': { n: '1', d: '10' } };
    const analise = await requisitar(`/api/unidades/${unidade.id}/analyze`, {
      sessao: user, metodo: 'POST', corpo: { campos: discrepantes },
    });
    expect(analise.status).toBe(200);
    expect(analise.body.campos['4.1.1'].origem).toBe('ml');
    expect(analise.body.campos['4.1.1'].observacoesHistoricas).toBe(12);
  });

  it('permite à CAM devolver com parecer ou aprovar e reflete o fluxo no painel', async () => {
    const unidade = await criarUnidade();
    const conta = await criarConta({ unidadeId: unidade.id });
    expect(conta.status).toBe(201);
    const user = await loginComSenhaPessoal('user@example.test', 'StrongUser2026!Pass');
    const campos = camposValidos(unidade);

    const submetido = await requisitar(`/api/unidades/${unidade.id}/submit`, {
      sessao: user, metodo: 'POST', corpo: { campos, justificativas: {} },
    });
    expect(submetido.status).toBe(200);
    expect(submetido.body.unidades.find(item => item.id === unidade.id).status).toBe('Em Análise');
    expect(Number((await db.prepare('SELECT COUNT(*) AS total FROM historico WHERE unidade_id = ? AND aprovado = 1').get(unidade.id)).total)).toBe(0);

    expect((await requisitar(`/api/unidades/${unidade.id}/review`, {
      sessao: user, metodo: 'POST', corpo: { decisao: 'approve' },
    })).status).toBe(403);
    expect((await requisitar(`/api/unidades/${unidade.id}/review`, {
      sessao: cam, metodo: 'POST', corpo: { decisao: 'return', parecer: 'Curto demais.' },
    })).status).toBe(400);

    const parecer = 'Corrija o denominador e detalhe a origem do dado informado.';
    const prazoResposta = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    expect((await requisitar(`/api/unidades/${unidade.id}/review`, {
      sessao: cam, metodo: 'POST', corpo: { decisao: 'return', parecer },
    })).status).toBe(400);
    expect((await requisitar(`/api/unidades/${unidade.id}/review`, {
      sessao: cam, metodo: 'POST', corpo: { decisao: 'return', parecer, prazoResposta: '2000-01-01' },
    })).status).toBe(400);
    const devolvido = await requisitar(`/api/unidades/${unidade.id}/review`, {
      sessao: cam, metodo: 'POST', corpo: { decisao: 'return', parecer, prazoResposta },
    });
    expect(devolvido.status).toBe(200);
    expect(devolvido.body.unidades.find(item => item.id === unidade.id)).toMatchObject({
      status: 'Devolvido',
      parecerCam: parecer,
      prazoResposta,
      revisadoPor: cam.user.nome,
    });
    expect(devolvido.body.enviadas[unidade.id]).toBe(true);
    expect(Number((await db.prepare('SELECT COUNT(*) AS total FROM historico WHERE unidade_id = ?').get(unidade.id)).total)).toBe(0);

    const rascunho = await requisitar(`/api/unidades/${unidade.id}/draft`, {
      sessao: user, metodo: 'POST', corpo: {
        campos, justificativas: {}, respostaUnidade: 'Corrigimos o denominador conforme os registros atualizados.',
      },
    });
    expect(rascunho.status).toBe(200);
    expect(rascunho.body.unidades.find(item => item.id === unidade.id)).toMatchObject({
      status: 'Devolvido',
      prazoResposta,
    });
    const respostaUnidade = 'Corrigimos o denominador conforme os registros atualizados.';
    expect(rascunho.body.unidades.find(item => item.id === unidade.id).respostaUnidade).toBe(respostaUnidade);

    expect((await requisitar(`/api/unidades/${unidade.id}/submit`, {
      sessao: user, metodo: 'POST', corpo: { campos, justificativas: {} },
    })).status).toBe(400);
    const reenviado = await requisitar(`/api/unidades/${unidade.id}/submit`, {
      sessao: user, metodo: 'POST', corpo: { campos, justificativas: {}, respostaUnidade },
    });
    expect(reenviado.status).toBe(200);
    expect(reenviado.body.unidades.find(item => item.id === unidade.id)).toMatchObject({
      status: 'Em Análise',
      parecerCam: null,
      respostaUnidade,
    });
    const estadoCam = await requisitar('/api/state', { sessao: cam });
    expect(estadoCam.body.unidades.find(item => item.id === unidade.id).respostaUnidade).toBe(respostaUnidade);

    const aprovado = await requisitar(`/api/unidades/${unidade.id}/review`, {
      sessao: cam, metodo: 'POST', corpo: { decisao: 'approve' },
    });
    expect(aprovado.status).toBe(200);
    expect(aprovado.body.unidades.find(item => item.id === unidade.id).status).toBe('Aprovado');
    const historico = await db.prepare('SELECT COUNT(*) AS total, SUM(aprovado) AS aprovados FROM historico WHERE unidade_id = ?').get(unidade.id);
    expect(historico.total).toBeGreaterThan(0);
    expect(historico.aprovados).toBe(historico.total);
    expect((await requisitar(`/api/unidades/${unidade.id}/draft`, {
      sessao: user, metodo: 'POST', corpo: { campos, justificativas: {} },
    })).status).toBe(409);
  });

  it('impede desativação da última conta CAM e fecha a sessão de usuários desativados', async () => {
    const selfDeactivate = await requisitar(`/api/usuarios/${cam.user.id}/deactivate`, { sessao: cam, metodo: 'POST' });
    expect(selfDeactivate.status).toBe(400);

    const unidade = await criarUnidade();
    const conta = await criarConta({ unidadeId: unidade.id });
    const user = await loginComSenhaPessoal('user@example.test', 'StrongUser2026!Pass');
    const contaPublica = conta.body.users.find(item => item.email === 'user@example.test');
    expect(contaPublica).toMatchObject({ unidadeId: unidade.id, deveTrocarSenha: true });
    const id = contaPublica.id;
    expect((await requisitar(`/api/usuarios/${id}/deactivate`, { sessao: cam, metodo: 'POST' })).status).toBe(200);
    expect((await requisitar('/api/state', { sessao: user })).status).toBe(401);
  });

  it('altera senha, revoga as outras sessões e registra eventos de auditoria', async () => {
    const primeiraSessao = await login(camEmail, camPassword);
    const segundaSessao = await login(camEmail, camPassword);
    const troca = await requisitar('/api/auth/password', {
      sessao: primeiraSessao, metodo: 'POST',
      corpo: { senhaAtual: camPassword, novaSenha: 'NewStrongCam2026!Password' },
    });
    expect(troca.status).toBe(200);
    expect((await requisitar('/api/state', { sessao: segundaSessao })).status).toBe(401);
    const novoLogin = await requisitar('/api/auth/login', { metodo: 'POST', corpo: { email: camEmail, senha: 'NewStrongCam2026!Password' } });
    expect(novoLogin.status).toBe(200);
    expect(novoLogin.body.user.deveTrocarSenha).toBe(false);
    expect(Number((await db.prepare('SELECT COUNT(*) AS total FROM auditoria').get()).total)).toBeGreaterThan(0);
  });

  it('bloqueia dados até a troca da senha inicial', async () => {
    const unidade = await criarUnidade();
    expect((await criarConta({ unidadeId: unidade.id })).status).toBe(201);
    const usuarioInicial = await login('user@example.test', 'StrongUser2026!Pass');
    expect(usuarioInicial.user.deveTrocarSenha).toBe(true);
    expect((await requisitar('/api/state', { sessao: usuarioInicial })).status).toBe(403);
    const troca = await requisitar('/api/auth/password', {
      sessao: usuarioInicial, metodo: 'POST',
      corpo: { senhaAtual: 'StrongUser2026!Pass', novaSenha: 'MyPrivate2026!Updated' },
    });
    expect(troca.status).toBe(200);
    expect((await requisitar('/api/state', { sessao: usuarioInicial })).status).toBe(200);
  });
});
