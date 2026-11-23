import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { abrirBanco as abrirBancoPostgres } from './database.mjs';
import {
  DISTRITOS, MATRIZ_KEYS, PROFILES, TIPOS_UNIDADE, calcularNotaGratificacao, indicadoresDaUnidade,
  pesosValidos, progressoDe, regrasValidas,
} from '../src/domain.ts';
import { analisarCampos, resultadoImpedeEnvio } from '../src/ml.ts';

const scrypt = promisify(scryptCallback);
const MAX_BODY_BYTES = 1_000_000;
const SESSION_MS = 8 * 60 * 60 * 1000;
const PASSWORD_MIN_LENGTH = 12;
const COOKIE_NAME = 'gratificai_session';
const DUMMY_PASSWORD_HASH = `scrypt$gratificai-dummy-salt$${scryptSync('gratificai-dummy-password', 'gratificai-dummy-salt', 64).toString('hex')}`;
const LOGIN_ATTEMPTS = new Map();
const TIPOS_DISTRITAIS = new Set(['gg', 'sna', 'snb1', 'snb2']);
const TIPOS_UNIDADE_PROFILE = new Set(['usf', 'caps', 'cecon', 'mac']);
const TIPOS_COMPATIVEIS = {
  usf: new Set(['USF', 'UBT', 'UBT MISTA', 'UCIS', 'SAE', 'NDI']),
  caps: new Set(['CAPS']),
  cecon: new Set(['CECON', 'CECO']),
  mac: new Set(['MAC']),
};

const distritosBase = DISTRITOS.map(({ id, nome }) => ({ id, nome }));

function hash(valor) {
  return createHash('sha256').update(valor).digest('hex');
}

function ehObjeto(valor) {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
}

function validarSenha(senha) {
  return typeof senha === 'string' && senha.length >= PASSWORD_MIN_LENGTH && senha.length <= 256 &&
    /[a-z]/.test(senha) && /[A-Z]/.test(senha) && /\d/.test(senha);
}

async function hashSenha(senha) {
  const salt = randomBytes(16).toString('hex');
  const chave = await scrypt(senha, salt, 64);
  return `scrypt$${salt}$${chave.toString('hex')}`;
}

async function conferirSenha(senha, registro) {
  const [algoritmo, salt, derivada] = registro.split('$');
  if (algoritmo !== 'scrypt' || !salt || !derivada) return false;
  const esperada = Buffer.from(derivada, 'hex');
  const recebida = await scrypt(senha, salt, esperada.length);
  return recebida.length === esperada.length && timingSafeEqual(recebida, esperada);
}

export const abrirBanco = abrirBancoPostgres;

export async function provisionarCAMInicial(db, { email, nome = 'Administrador CAM', senha }) {
  if (Number((await db.prepare('SELECT COUNT(*) AS total FROM usuarios').get()).total) > 0) {
    throw new Error('O CAM inicial só pode ser provisionado quando não existe nenhum usuário.');
  }
  if (!validarSenha(senha)) throw new Error('A senha inicial deve ter pelo menos 12 caracteres, uma letra maiúscula, uma minúscula e um número.');
  const emailNormalizado = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (emailNormalizado.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNormalizado)) {
    throw new Error('Informe um e-mail válido para a conta CAM inicial.');
  }
  const senhaHash = await hashSenha(senha);
  const criadoEm = new Date().toISOString();
  await db.prepare(`
    INSERT INTO usuarios (id, nome, email, senha_hash, perfil, deve_trocar_senha, criado_em)
    VALUES (?, ?, ?, ?, 'cam', 1, ?)
  `).run(randomUUID(), nome.trim().slice(0, 120) || 'Administrador CAM', emailNormalizado, senhaHash, criadoEm);
}

function enviar(res, status, corpo, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    ...headers,
  });
  res.end(JSON.stringify(corpo));
}

function rotaParaLog(pathname) {
  const rotasFixas = new Set([
    '/api/health', '/api/auth/setup', '/api/auth/login', '/api/auth/session',
    '/api/auth/logout', '/api/auth/password', '/api/state', '/api/unidades',
    '/api/usuarios', '/api/portarias',
  ]);
  if (rotasFixas.has(pathname)) return pathname;

  const unidade = pathname.match(/^\/api\/unidades\/\d+\/(analyze|draft|submit|review)$/);
  if (unidade) return `/api/unidades/:id/${unidade[1]}`;

  const usuario = pathname.match(/^\/api\/usuarios\/[0-9a-f-]{36}\/(activate|deactivate)$/i);
  if (usuario) return `/api/usuarios/:id/${usuario[1]}`;

  const portaria = pathname.match(/^\/api\/portarias\/[^/]+(?:\/(activate))?$/);
  if (portaria) return `/api/portarias/:id${portaria[1] ? '/activate' : ''}`;

  return '/other';
}

async function lerJson(req) {
  const partes = [];
  let tamanho = 0;
  for await (const parte of req) {
    tamanho += parte.length;
    if (tamanho > MAX_BODY_BYTES) throw Object.assign(new Error('Corpo da requisição excede o limite.'), { status: 413 });
    partes.push(parte);
  }
  try {
    return JSON.parse(Buffer.concat(partes).toString('utf8'));
  } catch {
    throw Object.assign(new Error('O corpo deve conter JSON válido.'), { status: 400 });
  }
}

function cookiesDaRequisicao(req) {
  const cookies = {};
  for (const parte of (req.headers.cookie ?? '').split(';')) {
    const [chave, ...valor] = parte.trim().split('=');
    if (chave) cookies[chave] = valor.join('=');
  }
  return cookies;
}

function userPublico(usuario) {
  return {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    perfil: usuario.perfil,
    distrito: usuario.distrito_id,
    unidadeId: usuario.unidade_id,
    unidadeNome: usuario.unidade_nome ?? null,
    ativo: Boolean(usuario.ativo),
    deveTrocarSenha: Boolean(usuario.deve_trocar_senha),
  };
}

async function usuarioDaSessao(db, req) {
  const token = cookiesDaRequisicao(req)[COOKIE_NAME];
  if (!token || !/^[\w-]{40,60}$/.test(token)) return null;
  const sessao = await db.prepare(`
    SELECT s.token_hash, s.csrf_token, u.*, un.nome AS unidade_nome
    FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
    LEFT JOIN unidades un ON un.id = u.unidade_id
    WHERE s.token_hash = ? AND s.expira_em > ? AND u.ativo = 1
  `).get(hash(token), Date.now());
  if (!sessao) return null;
  return { sessao, usuario: sessao };
}

function origenPermitido(req, allowedOrigins) {
  const origin = req.headers.origin;
  return !origin || allowedOrigins.has(origin);
}

function csrfValido(req, sesion) {
  const token = req.headers['x-csrf-token'];
  if (typeof token !== 'string') return false;
  const apresentado = Buffer.from(token);
  const esperado = Buffer.from(sesion.csrf_token);
  return apresentado.length === esperado.length && timingSafeEqual(apresentado, esperado);
}

function limitarTentativas(req, email) {
  const ip = req.socket.remoteAddress ?? 'unknown';
  const key = `${ip}:${email}`;
  const now = Date.now();
  const item = LOGIN_ATTEMPTS.get(key);
  if (item && item.ate > now && item.tentativas >= 5) return { bloqueado: true, key };
  if (item?.ate && item.ate <= now) LOGIN_ATTEMPTS.delete(key);
  return { bloqueado: false, key };
}

function falhaLogin(key) {
  if (LOGIN_ATTEMPTS.size >= 10_000) {
    const now = Date.now();
    for (const [registro, item] of LOGIN_ATTEMPTS) if (item.ate <= now) LOGIN_ATTEMPTS.delete(registro);
    if (LOGIN_ATTEMPTS.size >= 10_000) LOGIN_ATTEMPTS.delete(LOGIN_ATTEMPTS.keys().next().value);
  }
  const anterior = LOGIN_ATTEMPTS.get(key);
  const agora = Date.now();
  LOGIN_ATTEMPTS.set(key, {
    tentativas: anterior?.ate > agora ? anterior.tentativas + 1 : 1,
    ate: agora + 15 * 60 * 1000,
  });
}

function sucessoLogin(key) {
  LOGIN_ATTEMPTS.delete(key);
}

async function listarPortarias(db) {
  return (await db.prepare('SELECT payload FROM portarias ORDER BY ordem').all()).map(row => JSON.parse(row.payload));
}

async function carregarPortariaVigente(db) {
  const id = (await db.prepare('SELECT valor FROM configuracao WHERE chave = ?').get('vigente_id'))?.valor;
  const registro = await db.prepare('SELECT payload FROM portarias WHERE id = ?').get(id);
  return registro ? JSON.parse(registro.payload) : (await listarPortarias(db))[0];
}

function usuarioPodeAcessarUnidade(usuario, unidade) {
  if (usuario.perfil === 'cam') return true;
  if (TIPOS_DISTRITAIS.has(usuario.perfil)) return usuario.distrito_id === (unidade.distrito_id ?? unidade.distrito);
  if (TIPOS_UNIDADE_PROFILE.has(usuario.perfil)) return usuario.unidade_id === unidade.id;
  return false;
}

async function carregarEstado(db, usuario) {
  const todas = await db.prepare('SELECT id, nome, tipo, distrito_id AS distrito FROM unidades ORDER BY nome').all();
  const unidades = todas.filter(unidade => usuarioPodeAcessarUnidade(usuario, unidade));
  const lancamentos = {};
  const enviadas = {};
  const justificativas = {};
  const portaria = await carregarPortariaVigente(db);

  for (const unidade of unidades) {
    const registro = await db.prepare(`
      SELECT l.campos, l.justificativas, l.perfil_lancamento, l.status, l.parecer_cam, l.prazo_resposta,
        l.resposta_unidade, l.revisado_em,
        u.nome AS revisado_por_nome
      FROM lancamentos l
      LEFT JOIN usuarios u ON u.id = l.revisado_por
      WHERE l.unidade_id = ?
    `).get(unidade.id);
    const campos = registro ? JSON.parse(registro.campos) : {};
    const indicadores = indicadoresDaUnidade(unidade, portaria.pesos);
    const preenchimento = progressoDe(indicadores, campos).pct;
    const status = registro?.status ?? 'pendente';
    unidade.status = {
      pendente: 'Pendente',
      em_analise: 'Em Análise',
      devolvido: 'Devolvido',
      aprovado: 'Aprovado',
    }[status] ?? 'Pendente';
    unidade.preenchimento = preenchimento;
    const calculo = calcularNotaGratificacao(unidade, campos, portaria, registro?.perfil_lancamento);
    unidade.nota = registro ? calculo.nota : null;
    unidade.gratificacaoEsperada = registro ? calculo.gratificacaoEsperada : null;
    unidade.notaCompleta = Boolean(registro && calculo.completa);
    unidade.parecerCam = registro?.parecer_cam ?? null;
    unidade.prazoResposta = registro?.prazo_resposta ?? null;
    unidade.respostaUnidade = registro?.resposta_unidade ?? null;
    unidade.revisadoPor = registro?.revisado_por_nome ?? null;
    unidade.revisadoEm = registro?.revisado_em ?? null;
    lancamentos[unidade.id] = campos;
    justificativas[unidade.id] = registro ? JSON.parse(registro.justificativas) : {};
    if (status !== 'pendente') enviadas[unidade.id] = true;
  }

  const users = usuario.perfil === 'cam'
    ? (await db.prepare(`
      SELECT id, nome, email, perfil, distrito_id AS distrito, unidade_id AS "unidadeId",
        ativo, deve_trocar_senha AS "deveTrocarSenha", criado_em AS "criadoEm"
      FROM usuarios ORDER BY nome
    `).all()).map(row => ({ ...row, ativo: Boolean(row.ativo), deveTrocarSenha: Boolean(row.deveTrocarSenha) }))
    : [];
  return {
    user: userPublico(usuario),
    unidades,
    distritos: distritosBase.filter(distrito => usuario.perfil === 'cam' || usuario.distrito_id === distrito.id || unidades.some(u => u.distrito === distrito.id)),
    users,
    portarias: await listarPortarias(db),
    vigenteId: (await db.prepare('SELECT valor FROM configuracao WHERE chave = ?').get('vigente_id'))?.valor ?? 'cam-1.2',
    lancamentos,
    enviadas,
    justificativas,
  };
}

function validarCampos(campos) {
  if (!ehObjeto(campos)) return 'Campos de lançamento inválidos.';
  for (const [id, campo] of Object.entries(campos)) {
    if (!/^[\w.]+$/.test(id) || !ehObjeto(campo) ||
      typeof campo.n !== 'string' || typeof campo.d !== 'string' || campo.n.length > 40 || campo.d.length > 40) {
      return 'Cada subindicador deve conter numerador e denominador em texto, com até 40 caracteres.';
    }
  }
  return null;
}

function validarPortaria(pesos, regras) {
  return ehObjeto(pesos) && MATRIZ_KEYS.every(chave =>
    Array.isArray(pesos[chave]) && pesos[chave].length === 5 && pesos[chave].every(Number.isFinite),
  ) && pesosValidos(pesos) && ehObjeto(regras) &&
    Object.values(regras).every(valor => typeof valor === 'number' && Number.isFinite(valor)) && regrasValidas(regras);
}

async function registrarAuditoria(db, usuarioId, acao, detalhes = {}) {
  await db.prepare('INSERT INTO auditoria (usuario_id, acao, detalhes, criado_em) VALUES (?, ?, ?, ?)')
    .run(usuarioId, acao, JSON.stringify(detalhes), new Date().toISOString());
}

async function validarNovaConta(body, db) {
  if (!ehObjeto(body) || typeof body.nome !== 'string' || !body.nome.trim() || body.nome.length > 120 ||
    typeof body.email !== 'string' || body.email.trim().length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) ||
    !validarSenha(body.senha) || !Object.hasOwn(PROFILES, body.perfil)) {
    return 'Informe nome, e-mail válido, perfil e senha com pelo menos 12 caracteres, letras maiúsculas/minúsculas e número.';
  }
  if (TIPOS_DISTRITAIS.has(body.perfil)) {
    if (!await db.prepare('SELECT 1 FROM distritos WHERE id = ?').get(body.distrito)) return 'Selecione um distrito válido para este perfil.';
  } else if (TIPOS_UNIDADE_PROFILE.has(body.perfil)) {
    const unidade = await db.prepare('SELECT id, tipo FROM unidades WHERE id = ?').get(body.unidadeId);
    if (!unidade || !TIPOS_COMPATIVEIS[body.perfil].has(unidade.tipo)) return 'Selecione uma unidade compatível com o perfil.';
  } else if (body.perfil !== 'cam') {
    return 'Perfil não permitido.';
  }
  return null;
}

function limparCookie(secure) {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function criarServidorApi(db, configuracao = {}) {
  if (process.env.NODE_ENV === 'production' && !process.env.APP_ORIGIN && !configuracao.allowedOrigins) {
    throw new Error('Defina APP_ORIGIN com a origem HTTPS pública antes de executar em produção.');
  }
  const allowedOrigins = new Set(
    (configuracao.allowedOrigins ?? (process.env.APP_ORIGIN ? [process.env.APP_ORIGIN] : ['http://localhost:5173', 'http://127.0.0.1:5173']))
      .map(origin => origin.replace(/\/$/, '')),
  );
  if (process.env.NODE_ENV === 'production' && [...allowedOrigins].some(origin => {
    try {
      const parsed = new URL(origin);
      return parsed.protocol !== 'https:' || parsed.origin !== origin;
    } catch {
      return true;
    }
  })) {
    throw new Error('Em produção, configure somente origens HTTPS válidas em APP_ORIGIN.');
  }
  const secureCookie = configuracao.secureCookie ?? process.env.NODE_ENV === 'production';
  const logger = configuracao.logger ?? console;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const inicio = Date.now();
    res.on('finish', () => {
      logger.info(JSON.stringify({
        event: 'api_access',
        method: req.method ?? 'GET',
        route: rotaParaLog(url.pathname),
        status: res.statusCode,
        durationMs: Date.now() - inicio,
      }));
    });
    const mutavel = !['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? 'GET');
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
      res.setHeader('content-security-policy', "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    }

    try {
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return enviar(res, 200, { status: 'ok' });
      }

      if (req.method === 'GET' && url.pathname === '/api/auth/setup') {
        return enviar(res, 200, { setupRequired: Number((await db.prepare('SELECT COUNT(*) AS total FROM usuarios').get()).total) === 0 });
      }

      if (mutavel && !origenPermitido(req, allowedOrigins)) {
        return enviar(res, 403, { error: 'Origem da requisição não autorizada.' });
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/login') {
        const body = await lerJson(req);
        const emailRecebido = typeof body?.email === 'string' ? body.email : '';
        const email = emailRecebido.length <= 254 ? emailRecebido.trim().toLowerCase() : '';
        const senha = typeof body?.senha === 'string' ? body.senha : '';
        const tentativa = limitarTentativas(req, email);
        if (tentativa.bloqueado) return enviar(res, 429, { error: 'Muitas tentativas de acesso. Aguarde 15 minutos antes de tentar novamente.' });

        const usuario = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? await db.prepare(`
          SELECT u.*, un.nome AS unidade_nome
          FROM usuarios u LEFT JOIN unidades un ON un.id = u.unidade_id
          WHERE u.email = ? AND u.ativo = 1
        `).get(email) : undefined;
        const senhaConfere = senha.length <= 256 &&
          await conferirSenha(senha, usuario?.senha_hash ?? DUMMY_PASSWORD_HASH);
        const valido = Boolean(usuario && senhaConfere);
        if (!valido) {
          falhaLogin(tentativa.key);
          return enviar(res, 401, { error: 'E-mail ou senha inválidos.' });
        }

        sucessoLogin(tentativa.key);
        await db.prepare('DELETE FROM sessoes WHERE expira_em <= ?').run(Date.now());
        const token = randomBytes(32).toString('base64url');
        const csrfToken = randomBytes(32).toString('base64url');
        const expira = Date.now() + SESSION_MS;
        await db.prepare('INSERT INTO sessoes (token_hash, usuario_id, csrf_token, expira_em, criada_em) VALUES (?, ?, ?, ?, ?)')
          .run(hash(token), usuario.id, csrfToken, expira, new Date().toISOString());
        await registrarAuditoria(db, usuario.id, 'login');
        return enviar(res, 200, { user: userPublico(usuario), csrfToken }, {
          'set-cookie': `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${secureCookie ? '; Secure' : ''}`,
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/auth/session') {
        const auth = await usuarioDaSessao(db, req);
        if (!auth) return enviar(res, 200, { user: null });
        return enviar(res, 200, { user: userPublico(auth.usuario), csrfToken: auth.sessao.csrf_token });
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
        const auth = await usuarioDaSessao(db, req);
        if (!auth) return enviar(res, 200, { ok: true }, { 'set-cookie': limparCookie(secureCookie) });
        if (!csrfValido(req, auth.sessao)) return enviar(res, 403, { error: 'Token de proteção inválido. Atualize a página e tente novamente.' });
        await db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(auth.sessao.token_hash);
        await registrarAuditoria(db, auth.usuario.id, 'logout');
        return enviar(res, 200, { ok: true }, { 'set-cookie': limparCookie(secureCookie) });
      }

      const auth = await usuarioDaSessao(db, req);
      if (!auth) return enviar(res, 401, { error: 'Sessão encerrada. Entre novamente.' }, { 'set-cookie': limparCookie(secureCookie) });
      if (mutavel && !csrfValido(req, auth.sessao)) return enviar(res, 403, { error: 'Token de proteção inválido. Atualize a página e tente novamente.' });
      const { usuario, sessao } = auth;
      if (usuario.deve_trocar_senha && !['/api/auth/password', '/api/auth/logout'].includes(url.pathname)) {
        return enviar(res, 403, { error: 'Altere a senha inicial antes de acessar o sistema.' });
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/password') {
        const body = await lerJson(req);
        if (typeof body?.senhaAtual !== 'string' || !await conferirSenha(body.senhaAtual, usuario.senha_hash)) {
          return enviar(res, 401, { error: 'A senha atual não confere.' });
        }
        if (!validarSenha(body.novaSenha)) {
          return enviar(res, 400, { error: 'A nova senha deve ter pelo menos 12 caracteres, letras maiúsculas/minúsculas e número.' });
        }
        await db.prepare('UPDATE usuarios SET senha_hash = ?, deve_trocar_senha = 0 WHERE id = ?').run(await hashSenha(body.novaSenha), usuario.id);
        await db.prepare('DELETE FROM sessoes WHERE usuario_id = ? AND token_hash != ?').run(usuario.id, sessao.token_hash);
        await registrarAuditoria(db, usuario.id, 'senha_alterada');
        return enviar(res, 200, { ok: true });
      }

      if (req.method === 'GET' && url.pathname === '/api/state') return enviar(res, 200, await carregarEstado(db, usuario));

      const revisaoMatch = url.pathname.match(/^\/api\/unidades\/(\d+)\/review$/);
      if (revisaoMatch) {
        if (req.method !== 'POST') return enviar(res, 405, { error: 'Método não permitido.' });
        if (usuario.perfil !== 'cam') return enviar(res, 403, { error: 'Apenas a CAM pode revisar lançamentos.' });
        const unidadeId = Number(revisaoMatch[1]);
        const unidade = await db.prepare('SELECT id FROM unidades WHERE id = ?').get(unidadeId);
        if (!unidade) return enviar(res, 404, { error: 'Unidade não encontrada.' });

        const body = await lerJson(req);
        if (!ehObjeto(body) || !['approve', 'return'].includes(body.decisao)) {
          return enviar(res, 400, { error: 'Escolha aprovar ou devolver o lançamento.' });
        }
        const parecer = body.decisao === 'return' && typeof body.parecer === 'string' ? body.parecer.trim() : '';
        if (body.decisao === 'return' && (parecer.length < 20 || parecer.length > 1000)) {
          return enviar(res, 400, { error: 'Informe um parecer de pelo menos 20 caracteres para devolver o lançamento.' });
        }
        const prazoResposta = body.decisao === 'return' && typeof body.prazoResposta === 'string' ? body.prazoResposta : '';
        const dataPrazo = new Date(`${prazoResposta}T00:00:00.000Z`);
        if (body.decisao === 'return' && (
          !/^\d{4}-\d{2}-\d{2}$/.test(prazoResposta) ||
          Number.isNaN(dataPrazo.getTime()) || dataPrazo.toISOString().slice(0, 10) !== prazoResposta ||
          prazoResposta < new Date().toISOString().slice(0, 10)
        )) {
          return enviar(res, 400, { error: 'Informe um prazo de resposta válido, a partir de hoje.' });
        }

        await db.transaction(async () => {
          const atual = await db.prepare('SELECT status, atualizado_em FROM lancamentos WHERE unidade_id = ?').get(unidadeId);
          if (!atual || atual.status !== 'em_analise') {
            throw Object.assign(new Error('Somente lançamentos em análise podem ser revisados.'), { status: 409 });
          }
          const agora = new Date().toISOString();
          const status = body.decisao === 'approve' ? 'aprovado' : 'devolvido';
          const atualizacao = await db.prepare(`
            UPDATE lancamentos
            SET status = ?, enviado = 1, parecer_cam = ?, prazo_resposta = ?, revisado_por = ?, revisado_em = ?, atualizado_em = ?
            WHERE unidade_id = ? AND status = 'em_analise'
          `).run(status, body.decisao === 'return' ? parecer : null,
            body.decisao === 'return' ? prazoResposta : null, usuario.id, agora, agora, unidadeId);
          if (atualizacao.changes !== 1) {
            throw Object.assign(new Error('O lançamento já foi revisado por outra solicitação.'), { status: 409 });
          }
          if (body.decisao === 'approve') {
            await db.prepare('UPDATE historico SET aprovado = 1 WHERE unidade_id = ? AND submetido_em = ?')
              .run(unidadeId, atual.atualizado_em);
          } else {
            await db.prepare('DELETE FROM historico WHERE unidade_id = ? AND submetido_em = ? AND aprovado = 0')
              .run(unidadeId, atual.atualizado_em);
          }
          await registrarAuditoria(db, usuario.id, `lancamento_${status}`, { unidadeId });
        });
        return enviar(res, 200, await carregarEstado(db, usuario));
      }

      const unidadeMatch = url.pathname.match(/^\/api\/unidades\/(\d+)\/(analyze|draft|submit)$/);
      if (unidadeMatch) {
        const unidadeId = Number(unidadeMatch[1]);
        const unidade = await db.prepare('SELECT id, nome, tipo, distrito_id AS distrito FROM unidades WHERE id = ?').get(unidadeId);
        if (!unidade || !usuarioPodeAcessarUnidade(usuario, unidade)) return enviar(res, 403, { error: 'Sem permissão para acessar esta unidade.' });
        if (req.method !== 'POST') return enviar(res, 405, { error: 'Método não permitido.' });
        if (unidadeMatch[2] !== 'analyze' && usuario.perfil === 'cam') {
          return enviar(res, 403, { error: 'A CAM revisa lançamentos, mas não pode editar ou submeter dados da unidade.' });
        }
        const statusAtual = (await db.prepare('SELECT status FROM lancamentos WHERE unidade_id = ?').get(unidadeId))?.status ?? 'pendente';
        if (unidadeMatch[2] !== 'analyze' && ['em_analise', 'aprovado'].includes(statusAtual)) {
          return enviar(res, 409, { error: 'O lançamento está em análise ou já foi aprovado; aguarde a revisão da CAM.' });
        }
        const body = await lerJson(req);
        if (!ehObjeto(body) || !ehObjeto(body.campos)) return enviar(res, 400, { error: 'O corpo deve conter campos de lançamento válidos.' });
        const camposErro = validarCampos(body.campos);
        if (camposErro) return enviar(res, 400, { error: camposErro });
        const justificativas = body.justificativas ?? {};
        if (!ehObjeto(justificativas) || Object.entries(justificativas).some(([id, texto]) =>
          !/^[\w.]+$/.test(id) || typeof texto !== 'string' || texto.length > 1000)) {
          return enviar(res, 400, { error: 'Justificativas inválidas.' });
        }
        if (body.respostaUnidade !== undefined &&
          (typeof body.respostaUnidade !== 'string' || body.respostaUnidade.length > 1000)) {
          return enviar(res, 400, { error: 'A resposta à devolução deve ter até 1000 caracteres.' });
        }
        const respostaUnidade = typeof body.respostaUnidade === 'string' ? body.respostaUnidade.trim() : '';
        if (unidadeMatch[2] === 'submit' && statusAtual === 'devolvido' && respostaUnidade.length < 20) {
          return enviar(res, 400, { error: 'Explique as correções realizadas em pelo menos 20 caracteres antes de reenviar.' });
        }

        const portaria = await carregarPortariaVigente(db);
        const indicadores = indicadoresDaUnidade(unidade, portaria.pesos);
        const historicoRecente = await db.prepare(`
          SELECT id, sub_id AS "subId", valor
          FROM historico WHERE unidade_id = ? AND aprovado = 1
          ORDER BY id DESC
        `).all(unidadeId);
        const quantidadePorSub = new Map();
        const historico = historicoRecente.filter(registro => {
          const quantidade = quantidadePorSub.get(registro.subId) ?? 0;
          quantidadePorSub.set(registro.subId, quantidade + 1);
          return quantidade < 50;
        }).reverse();
        const analise = analisarCampos(indicadores, body.campos, historico);
        if (unidadeMatch[2] === 'analyze') return enviar(res, 200, analise);

        if (unidadeMatch[2] === 'draft') {
          await db.transaction(async () => {
            const atual = await db.prepare('SELECT status, parecer_cam, prazo_resposta, resposta_unidade, revisado_por, revisado_em FROM lancamentos WHERE unidade_id = ?').get(unidadeId);
            if (atual && ['em_analise', 'aprovado'].includes(atual.status)) {
              throw Object.assign(new Error('O lançamento está em análise ou já foi aprovado; aguarde a revisão da CAM.'), { status: 409 });
            }
            const statusRascunho = atual?.status === 'devolvido' ? 'devolvido' : 'pendente';
            const devolvido = statusRascunho === 'devolvido';
            const agora = new Date().toISOString();
            await db.prepare(`
              INSERT INTO lancamentos (
                unidade_id, campos, justificativas, perfil_lancamento, enviado, status, parecer_cam, prazo_resposta, resposta_unidade, revisado_por, revisado_em, atualizado_em
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(unidade_id) DO UPDATE SET
                campos = excluded.campos, justificativas = excluded.justificativas,
                perfil_lancamento = excluded.perfil_lancamento,
                enviado = excluded.enviado, status = excluded.status, parecer_cam = excluded.parecer_cam,
                resposta_unidade = excluded.resposta_unidade,
                revisado_por = excluded.revisado_por, revisado_em = excluded.revisado_em,
                atualizado_em = excluded.atualizado_em
            `).run(
              unidadeId, JSON.stringify(body.campos), JSON.stringify(justificativas), usuario.perfil, devolvido ? 1 : 0,
              statusRascunho, devolvido ? atual.parecer_cam : null,
              devolvido ? atual.prazo_resposta : null,
              devolvido ? (body.respostaUnidade === undefined ? atual.resposta_unidade : respostaUnidade || null) : null,
              devolvido ? atual.revisado_por : null,
              devolvido ? atual.revisado_em : null, agora,
            );
            await registrarAuditoria(db, usuario.id, 'rascunho_salvo', { unidadeId, modelo: analise.modelo });
          });
          return enviar(res, 200, await carregarEstado(db, usuario));
        }

        const requeridos = indicadores.filter(item => item.ativo).flatMap(item => item.subs);
        const preenchidos = progressoDe([{ id: 0, nome: '', descricao: '', ativo: true, subs: requeridos }], body.campos).preenchidos;
        if (!requeridos.length || preenchidos !== requeridos.length) {
          return enviar(res, 422, { error: 'Preencha todos os subindicadores com valores válidos antes de submeter.', analysis: analise });
        }
        for (const [id, resultado] of Object.entries(analise.campos)) {
          if (resultadoImpedeEnvio(resultado, justificativas[id] ?? '')) {
            const error = resultado.severidade === 'invalid'
              ? `Corrija o valor inválido do subindicador ${id} antes de submeter.`
              : `Inclua uma justificativa técnica de pelo menos 20 caracteres para ${id}.`;
            return enviar(res, 422, { error, analysis: analise });
          }
        }

        const agora = new Date().toISOString();
        await db.transaction(async () => {
          const atual = await db.prepare('SELECT status FROM lancamentos WHERE unidade_id = ?').get(unidadeId);
          if (atual && ['em_analise', 'aprovado'].includes(atual.status)) {
            throw Object.assign(new Error('O lançamento está em análise ou já foi aprovado; aguarde a revisão da CAM.'), { status: 409 });
          }
          await db.prepare(`
            INSERT INTO lancamentos (
              unidade_id, campos, justificativas, perfil_lancamento, enviado, status, parecer_cam, prazo_resposta, resposta_unidade, revisado_por, revisado_em, atualizado_em
            ) VALUES (?, ?, ?, ?, 1, 'em_analise', NULL, NULL, ?, NULL, NULL, ?)
            ON CONFLICT(unidade_id) DO UPDATE SET campos = excluded.campos,
              justificativas = excluded.justificativas, perfil_lancamento = excluded.perfil_lancamento,
              enviado = 1, status = 'em_analise',
              parecer_cam = NULL, prazo_resposta = NULL, resposta_unidade = excluded.resposta_unidade,
              revisado_por = NULL, revisado_em = NULL, atualizado_em = excluded.atualizado_em
          `).run(unidadeId, JSON.stringify(body.campos), JSON.stringify(justificativas), usuario.perfil,
            statusAtual === 'devolvido' ? respostaUnidade : null, agora);
          const inserirHistorico = db.prepare('INSERT INTO historico (unidade_id, sub_id, valor, submetido_em) VALUES (?, ?, ?, ?)');
          for (const sub of requeridos) {
            const n = Number(body.campos[sub.id].n.replace(',', '.'));
            const d = Number(body.campos[sub.id].d.replace(',', '.'));
            await inserirHistorico.run(unidadeId, sub.id, ['4.M2', '4.M3'].includes(sub.id) ? n / d : (n / d) * 100, agora);
          }
          await registrarAuditoria(db, usuario.id, 'lancamento_submetido', {
            unidadeId, modelo: analise.modelo,
            scoreMaximo: Math.max(0, ...Object.values(analise.campos).map(item => item.score)),
            indicadoresJustificados: Object.keys(justificativas),
          });
        });
        return enviar(res, 200, await carregarEstado(db, usuario));
      }

      if (req.method === 'POST' && url.pathname === '/api/unidades') {
        if (usuario.perfil !== 'cam') return enviar(res, 403, { error: 'Apenas a CAM pode cadastrar unidades.' });
        const body = await lerJson(req);
        if (!ehObjeto(body) || typeof body.nome !== 'string' || !body.nome.trim() || body.nome.length > 160 ||
          !TIPOS_UNIDADE.includes(body.tipo) || !(await db.prepare('SELECT 1 FROM distritos WHERE id = ?').get(body.distrito))) {
          return enviar(res, 400, { error: 'Informe nome, tipologia e distrito válidos.' });
        }
        try {
          const resultado = await db.prepare('INSERT INTO unidades (nome, tipo, distrito_id, criado_em) VALUES (?, ?, ?, ?)').run(
            body.nome.trim(), body.tipo, body.distrito, new Date().toISOString(),
          );
          await registrarAuditoria(db, usuario.id, 'unidade_criada', { unidadeId: Number(resultado.lastInsertRowid) });
        } catch (error) {
          if (error.code === '23505') return enviar(res, 409, { error: 'Já existe uma unidade com esse nome no distrito.' });
          throw error;
        }
        return enviar(res, 201, await carregarEstado(db, usuario));
      }

      if (req.method === 'POST' && url.pathname === '/api/usuarios') {
        if (usuario.perfil !== 'cam') return enviar(res, 403, { error: 'Apenas a CAM pode criar contas.' });
        const body = await lerJson(req);
        const erro = await validarNovaConta(body, db);
        if (erro) return enviar(res, 400, { error: erro });
        const email = body.email.trim().toLowerCase();
        const distritoId = TIPOS_DISTRITAIS.has(body.perfil) ? body.distrito : null;
        const unidadeId = TIPOS_UNIDADE_PROFILE.has(body.perfil) ? Number(body.unidadeId) : null;
        const id = randomUUID();
        try {
          await db.prepare(`
            INSERT INTO usuarios (id, nome, email, senha_hash, perfil, distrito_id, unidade_id, deve_trocar_senha, criado_em)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
          `).run(id, body.nome.trim(), email, await hashSenha(body.senha), body.perfil, distritoId, unidadeId, new Date().toISOString());
          await registrarAuditoria(db, usuario.id, 'usuario_criado', { usuarioId: id, email, perfil: body.perfil });
        } catch (error) {
          if (error.code === '23505') return enviar(res, 409, { error: 'Já existe uma conta com esse e-mail.' });
          throw error;
        }
        return enviar(res, 201, await carregarEstado(db, usuario));
      }

      const usuarioMatch = url.pathname.match(/^\/api\/usuarios\/([0-9a-f-]{36})\/(activate|deactivate)$/);
      if (req.method === 'POST' && usuarioMatch) {
        if (usuario.perfil !== 'cam') return enviar(res, 403, { error: 'Apenas a CAM pode administrar contas.' });
        if (usuarioMatch[1] === usuario.id && usuarioMatch[2] === 'deactivate') return enviar(res, 400, { error: 'Não é possível desativar a própria conta.' });
        const alvo = await db.prepare('SELECT id FROM usuarios WHERE id = ?').get(usuarioMatch[1]);
        if (!alvo) return enviar(res, 404, { error: 'Conta não encontrada.' });
        if (usuarioMatch[2] === 'deactivate') {
          const conta = await db.prepare('SELECT perfil FROM usuarios WHERE id = ?').get(alvo.id);
          const camsAtivos = Number((await db.prepare("SELECT COUNT(*) AS total FROM usuarios WHERE perfil = 'cam' AND ativo = 1").get()).total);
          if (conta.perfil === 'cam' && camsAtivos <= 1) return enviar(res, 400, { error: 'O sistema precisa manter pelo menos uma conta CAM ativa.' });
        }
        await db.prepare('UPDATE usuarios SET ativo = ? WHERE id = ?').run(usuarioMatch[2] === 'activate' ? 1 : 0, alvo.id);
        if (usuarioMatch[2] === 'deactivate') await db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(alvo.id);
        await registrarAuditoria(db, usuario.id, `usuario_${usuarioMatch[2]}`, { usuarioId: alvo.id });
        return enviar(res, 200, await carregarEstado(db, usuario));
      }

      if (req.method === 'POST' && url.pathname === '/api/portarias') {
        if (usuario.perfil !== 'cam') return enviar(res, 403, { error: 'Apenas a CAM pode criar portarias.' });
        const body = await lerJson(req);
        if (!ehObjeto(body) || typeof body.nome !== 'string' || !body.nome.trim() || body.nome.length > 200) {
          return enviar(res, 400, { error: 'Informe um nome de portaria válido (até 200 caracteres).' });
        }
        const base = await carregarPortariaVigente(db);
        const nova = { id: `portaria-${randomUUID()}`, nome: body.nome.trim(), pesos: base.pesos, regras: base.regras };
        await db.prepare('INSERT INTO portarias (id, payload) VALUES (?, ?)').run(nova.id, JSON.stringify(nova));
        await db.prepare(`INSERT INTO configuracao (chave, valor) VALUES (?, ?)
          ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`).run('vigente_id', nova.id);
        await registrarAuditoria(db, usuario.id, 'portaria_criada', { id: nova.id, nome: nova.nome });
        return enviar(res, 201, await carregarEstado(db, usuario));
      }

      const portariaMatch = url.pathname.match(/^\/api\/portarias\/([^/]+)(?:\/(activate))?$/);
      if (portariaMatch && (req.method === 'PUT' || (req.method === 'POST' && portariaMatch[2] === 'activate'))) {
        if (usuario.perfil !== 'cam') return enviar(res, 403, { error: 'Apenas a CAM pode parametrizar portarias.' });
        const id = decodeURIComponent(portariaMatch[1]);
        const atual = await db.prepare('SELECT payload FROM portarias WHERE id = ?').get(id);
        if (!atual) return enviar(res, 404, { error: 'Portaria não encontrada.' });
        if (portariaMatch[2] === 'activate') {
          await db.prepare(`INSERT INTO configuracao (chave, valor) VALUES (?, ?)
            ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`).run('vigente_id', id);
          await registrarAuditoria(db, usuario.id, 'portaria_ativada', { id });
        } else {
          const body = await lerJson(req);
          if (!ehObjeto(body) || !validarPortaria(body.pesos, body.regras)) return enviar(res, 400, { error: 'Pesos e regras inválidos.' });
          const portaria = { ...JSON.parse(atual.payload), pesos: body.pesos, regras: body.regras };
          await db.prepare('UPDATE portarias SET payload = ? WHERE id = ?').run(JSON.stringify(portaria), id);
          await registrarAuditoria(db, usuario.id, 'portaria_publicada', { id });
        }
        return enviar(res, 200, await carregarEstado(db, usuario));
      }

      return enviar(res, 404, { error: 'Rota da API não encontrada.' });
    } catch (error) {
      if (error?.status) return enviar(res, error.status, { error: error.message });
      console.error('Falha ao processar requisição da API:', error);
      return enviar(res, 500, { error: 'Falha interna ao processar a requisição.' });
    }
  });
  return server;
}
