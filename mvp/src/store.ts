import { useSyncExternalStore } from 'react';
import { Campos, Pesos, Profile, Regras, pesosValidos, regrasValidas } from './domain';
import {
  ApiError, StateApi, alterarStatusUsuarioApi, analisarLancamentoApi, ativarPortariaApi, criarPortariaApi,
  criarUnidadeApi, criarUsuarioApi, obterEstadoApi, publicarPortariaApi, revisarLancamentoApi, salvarRascunhoApi,
  submeterLancamentoApi, trocarSenhaApi,
} from './api';
import { ResultadoAnalise } from './ml';
import { DISTRITOS } from './domain';

export interface State extends StateApi {
  carregando: boolean;
  erro: string | null;
}

const inicial = (): State => ({
  user: { id: '', nome: '', email: '', perfil: 'cam', distrito: null, unidadeId: null, ativo: false, deveTrocarSenha: false },
  unidades: [], distritos: DISTRITOS, users: [], portarias: [], vigenteId: '',
  lancamentos: {}, enviadas: {}, justificativas: {}, carregando: true, erro: null,
});
let state: State = inicial();
let requisicaoDeEstado = 0;
const listeners = new Set<() => void>();

function commit(next: State) {
  state = next;
  listeners.forEach(listener => listener());
}

function incorporarApi(dados: StateApi) {
  commit({ ...dados, carregando: false, erro: null });
}

export const getState = () => state;

export function useStore(): State {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => state,
  );
}

export const portariaVigente = (s: State = state) => s.portarias.find(p => p.id === s.vigenteId) ?? s.portarias[0];

export async function carregarEstado({ silencioso = false }: { silencioso?: boolean } = {}): Promise<void> {
  const id = ++requisicaoDeEstado;
  if (!silencioso) commit({ ...state, carregando: true, erro: null });
  try {
    const dados = await obterEstadoApi();
    if (id === requisicaoDeEstado) incorporarApi(dados);
  } catch (error) {
    if (id === requisicaoDeEstado) {
      const mensagem = error instanceof ApiError ? error.message : 'Falha ao carregar os dados do backend.';
      commit({ ...state, carregando: false, erro: silencioso ? state.erro : mensagem });
    }
    throw error;
  }
}

export async function analisarLancamento(unidadeId: number, campos: Campos): Promise<ResultadoAnalise> {
  return analisarLancamentoApi(unidadeId, campos);
}

export async function salvarLancamento(unidadeId: number, campos: Campos, justificativas: Record<string, string> = {}, respostaUnidade?: string): Promise<void> {
  incorporarApi(await salvarRascunhoApi(unidadeId, campos, justificativas, respostaUnidade));
}

export async function submeter(unidadeId: number, campos: Campos, justificativas: Record<string, string> = {}, respostaUnidade?: string): Promise<void> {
  incorporarApi(await submeterLancamentoApi(unidadeId, campos, justificativas, respostaUnidade));
}

export async function revisarLancamento(unidadeId: number, decisao: 'approve' | 'return', parecer?: string, prazoResposta?: string): Promise<void> {
  incorporarApi(await revisarLancamentoApi(unidadeId, decisao, parecer, prazoResposta));
}

export async function definirVigente(id: string): Promise<void> {
  incorporarApi(await ativarPortariaApi(id));
}

export async function publicarPortaria(id: string, pesos: Pesos, regras: Regras): Promise<void> {
  if (!pesosValidos(pesos) || !regrasValidas(regras)) throw new ApiError('Pesos e regras inválidos.', 400);
  incorporarApi(await publicarPortariaApi(id, pesos, regras));
}

export async function criarPortaria(nome: string): Promise<void> {
  if (!nome.trim()) throw new ApiError('Informe o nome da portaria.', 400);
  incorporarApi(await criarPortariaApi(nome));
}

export async function criarUnidade(nome: string, tipo: string, distrito: string): Promise<void> {
  incorporarApi(await criarUnidadeApi(nome, tipo, distrito));
}

export async function criarUsuario(dados: { nome: string; email: string; senha: string; perfil: Profile; distrito?: string; unidadeId?: number }): Promise<void> {
  incorporarApi(await criarUsuarioApi(dados));
}

export async function alterarStatusUsuario(id: string, ativo: boolean): Promise<void> {
  incorporarApi(await alterarStatusUsuarioApi(id, ativo));
}

export async function trocarSenha(senhaAtual: string, novaSenha: string): Promise<void> {
  await trocarSenhaApi(senhaAtual, novaSenha);
}

export function limparEstadoLocal() {
  requisicaoDeEstado++;
  commit({ ...inicial(), carregando: false });
}
