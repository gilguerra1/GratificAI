import type { Campos, Distrito, Pesos, Portaria, Profile, Regras, Unidade } from './domain';
import { ResultadoAnalise } from './ml';

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  perfil: Profile;
  distrito: string | null;
  unidadeId: number | null;
  unidadeNome?: string | null;
  ativo: boolean;
  deveTrocarSenha: boolean;
}

export interface StateApi {
  user: Usuario;
  unidades: Unidade[];
  distritos: Distrito[];
  users: Usuario[];
  portarias: Portaria[];
  vigenteId: string;
  lancamentos: Record<number, Campos>;
  enviadas: Record<number, boolean>;
  justificativas: Record<number, Record<string, string>>;
}

let csrfToken = '';

export function configurarCsrf(token: string) {
  csrfToken = token;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

async function requisitar<T>(caminho: string, metodo = 'GET', corpo?: unknown): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(caminho, {
      method: metodo,
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        ...(metodo === 'GET' ? {} : { 'x-csrf-token': csrfToken }),
      },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    });
  } catch {
    throw new ApiError('Não foi possível conectar ao backend. Verifique se a API está em execução e tente novamente.', 0);
  }

  let dados: { error?: string } & Record<string, unknown>;
  try {
    dados = await resposta.json();
  } catch {
    throw new ApiError('O backend retornou uma resposta inválida.', resposta.status);
  }
  if (resposta.status === 401 && !['/api/auth/login', '/api/auth/session', '/api/auth/setup', '/api/auth/password'].includes(caminho)) {
    configurarCsrf('');
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('gratificai:unauthorized'));
  }
  if (!resposta.ok) throw new ApiError(dados.error ?? 'A solicitação não foi concluída.', resposta.status);
  return dados as T;
}

export const obterEstadoApi = () => requisitar<StateApi>('/api/state');
export const analisarLancamentoApi = (unidadeId: number, campos: Campos) =>
  requisitar<ResultadoAnalise>(`/api/unidades/${unidadeId}/analyze`, 'POST', { campos });
export const salvarRascunhoApi = (unidadeId: number, campos: Campos, justificativas: Record<string, string>, respostaUnidade?: string) =>
  requisitar<StateApi>(`/api/unidades/${unidadeId}/draft`, 'POST', { campos, justificativas, respostaUnidade });
export const submeterLancamentoApi = (unidadeId: number, campos: Campos, justificativas: Record<string, string>, respostaUnidade?: string) =>
  requisitar<StateApi>(`/api/unidades/${unidadeId}/submit`, 'POST', { campos, justificativas, respostaUnidade });
export const revisarLancamentoApi = (unidadeId: number, decisao: 'approve' | 'return', parecer?: string, prazoResposta?: string) =>
  requisitar<StateApi>(`/api/unidades/${unidadeId}/review`, 'POST', { decisao, parecer, prazoResposta });
export const criarPortariaApi = (nome: string) => requisitar<StateApi>('/api/portarias', 'POST', { nome });
export const ativarPortariaApi = (id: string) =>
  requisitar<StateApi>(`/api/portarias/${encodeURIComponent(id)}/activate`, 'POST');
export const publicarPortariaApi = (id: string, pesos: Pesos, regras: Regras) =>
  requisitar<StateApi>(`/api/portarias/${encodeURIComponent(id)}`, 'PUT', { pesos, regras });
export const criarUnidadeApi = (nome: string, tipo: string, distrito: string) =>
  requisitar<StateApi>('/api/unidades', 'POST', { nome, tipo, distrito });
export const criarUsuarioApi = (dados: { nome: string; email: string; senha: string; perfil: Profile; distrito?: string; unidadeId?: number }) =>
  requisitar<StateApi>('/api/usuarios', 'POST', dados);
export const alterarStatusUsuarioApi = (id: string, ativo: boolean) =>
  requisitar<StateApi>(`/api/usuarios/${id}/${ativo ? 'activate' : 'deactivate'}`, 'POST');
export const trocarSenhaApi = (senhaAtual: string, novaSenha: string) =>
  requisitar<{ ok: boolean }>('/api/auth/password', 'POST', { senhaAtual, novaSenha });

export interface RespostaAutenticada { user: Usuario; csrfToken: string }
export interface RespostaSessao { user: Usuario | null; csrfToken?: string }

export async function obterSessaoApi(): Promise<RespostaSessao> {
  const sessao = await requisitar<RespostaSessao>('/api/auth/session');
  if (sessao.user && sessao.csrfToken) configurarCsrf(sessao.csrfToken);
  else configurarCsrf('');
  return sessao;
}

export async function loginApi(email: string, senha: string): Promise<RespostaAutenticada> {
  const resposta = await requisitar<RespostaAutenticada>('/api/auth/login', 'POST', { email, senha });
  configurarCsrf(resposta.csrfToken);
  return resposta;
}

export async function logoutApi(): Promise<void> {
  await requisitar<{ ok: boolean }>('/api/auth/logout', 'POST');
  configurarCsrf('');
}

export const verificarSetupApi = () => requisitar<{ setupRequired: boolean }>('/api/auth/setup');
