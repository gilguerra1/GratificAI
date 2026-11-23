import { pctDe } from './domain.ts';
import type { Campos, MacroInd, SubInd } from './domain.ts';

export type SeveridadeValidacao = 'invalid' | 'warning';

export interface ResultadoCampo {
  severidade: SeveridadeValidacao;
  origem: 'regra' | 'ml';
  mensagem: string;
  score: number;
  precisaJustificativa: boolean;
  observacoesHistoricas: number;
}

export interface ResultadoAnalise {
  modelo: string;
  campos: Record<string, ResultadoCampo>;
}

interface ObservacaoHistorica {
  subId: string;
  valor: number;
}

const MODELO = 'isolation-forest-univariado-v1';
const METRICAS_MEDIA = new Set(['4.M2', '4.M3']);
const MINIMO_HISTORICO_ML = 12;
const MAX_AMOSTRA_ARVORE = 32;
const QUANTIDADE_ARVORES = 100;
const LIMIAR_ANOMALIA = 0.65;

interface NoIsolamento {
  tamanho: number;
  corte?: number;
  esquerda?: NoIsolamento;
  direita?: NoIsolamento;
}

function criarGerador(semente: number): () => number {
  let estado = semente || 0x6d2b79f5;
  return () => {
    estado = (Math.imul(estado, 1664525) + 1013904223) >>> 0;
    return estado / 0x100000000;
  };
}

function sementeDoHistorico(id: string, valores: number[]): number {
  let hash = 2166136261;
  for (const caractere of `${id}:${valores.join(',')}`) {
    hash = Math.imul(hash ^ caractere.charCodeAt(0), 16777619);
  }
  return hash >>> 0;
}

function comprimentoMedio(tamanho: number): number {
  if (tamanho <= 1) return 0;
  if (tamanho === 2) return 1;
  const constanteEuler = 0.5772156649;
  return 2 * (Math.log(tamanho - 1) + constanteEuler) - (2 * (tamanho - 1)) / tamanho;
}

function construirArvore(valores: number[], profundidade: number, profundidadeMaxima: number, aleatorio: () => number): NoIsolamento {
  const minimo = Math.min(...valores);
  const maximo = Math.max(...valores);
  if (profundidade >= profundidadeMaxima || valores.length <= 1 || minimo === maximo) {
    return { tamanho: valores.length };
  }

  const corte = minimo + aleatorio() * (maximo - minimo);
  const esquerda = valores.filter(valor => valor < corte);
  const direita = valores.filter(valor => valor >= corte);
  if (!esquerda.length || !direita.length) return { tamanho: valores.length };

  return {
    tamanho: valores.length,
    corte,
    esquerda: construirArvore(esquerda, profundidade + 1, profundidadeMaxima, aleatorio),
    direita: construirArvore(direita, profundidade + 1, profundidadeMaxima, aleatorio),
  };
}

function caminhoNaArvore(arvore: NoIsolamento, valor: number, profundidade = 0): number {
  if (arvore.corte === undefined || !arvore.esquerda || !arvore.direita) {
    return profundidade + comprimentoMedio(arvore.tamanho);
  }
  return valor < arvore.corte
    ? caminhoNaArvore(arvore.esquerda, valor, profundidade + 1)
    : caminhoNaArvore(arvore.direita, valor, profundidade + 1);
}

function pontuarIsolationForest(valores: number[], observado: number, id: string): number {
  const minimo = Math.min(...valores);
  const maximo = Math.max(...valores);
  if (minimo === maximo) return observado === minimo ? 0.5 : 1;

  const tamanhoAmostra = Math.min(MAX_AMOSTRA_ARVORE, valores.length);
  const profundidadeMaxima = Math.ceil(Math.log2(tamanhoAmostra));
  const aleatorio = criarGerador(sementeDoHistorico(id, valores));
  const arvores: NoIsolamento[] = [];

  for (let indice = 0; indice < QUANTIDADE_ARVORES; indice++) {
    const embaralhados = [...valores];
    for (let i = embaralhados.length - 1; i > 0; i--) {
      const j = Math.floor(aleatorio() * (i + 1));
      [embaralhados[i], embaralhados[j]] = [embaralhados[j], embaralhados[i]];
    }
    arvores.push(construirArvore(embaralhados.slice(0, tamanhoAmostra), 0, profundidadeMaxima, aleatorio));
  }

  const caminhoMedio = arvores.reduce((total, arvore) => total + caminhoNaArvore(arvore, observado), 0) / arvores.length;
  return 2 ** (-caminhoMedio / comprimentoMedio(tamanhoAmostra));
}

function valorNumerico(valor: string): number | null {
  if (!valor.trim()) return null;
  const normalizado = valor.trim().replace(',', '.');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalizado)) return null;
  const convertido = Number(normalizado);
  return Number.isFinite(convertido) ? convertido : null;
}

function invalid(mensagem: string): ResultadoCampo {
  return { severidade: 'invalid', origem: 'regra', mensagem, score: 1, precisaJustificativa: false, observacoesHistoricas: 0 };
}

function warning(
  mensagem: string,
  score = 0.75,
  observacoesHistoricas = 0,
  origem: ResultadoCampo['origem'] = 'regra',
): ResultadoCampo {
  return { severidade: 'warning', origem, mensagem, score, precisaJustificativa: true, observacoesHistoricas };
}

function analisarSubindicador(
  sub: SubInd,
  campos: Campos,
  historico: ObservacaoHistorica[],
): ResultadoCampo | undefined {
  const campo = campos[sub.id];
  if (!campo || (!campo.n.trim() && !campo.d.trim())) return undefined;
  if (!campo.n.trim() || !campo.d.trim()) return invalid('Informe numerador e denominador.');

  const n = valorNumerico(campo.n);
  const d = valorNumerico(campo.d);
  if (n === null || d === null) return invalid('Use valores numéricos válidos.');
  if (n < 0 || d < 0) return invalid('Numerador e denominador não podem ser negativos.');
  if (d === 0) return invalid('O denominador deve ser maior que zero.');

  if (sub.id === '1.1' && n === 0) {
    return warning('Nenhuma requisição Hórus foi informada. Confirme o dado ou registre a justificativa técnica.');
  }
  if (sub.id === '2.2' && n > 0) {
    return warning('Há abonos sem justificativa legal. Confirme a quantidade e registre a justificativa técnica.');
  }
  if (!METRICAS_MEDIA.has(sub.id) && n > d) {
    return invalid('O numerador não pode ser maior que o denominador neste indicador.');
  }
  if (METRICAS_MEDIA.has(sub.id) && n / d > sub.meta) {
    return warning(`O resultado excede a meta de ${sub.meta}. Confirme a unidade e o valor informado.`);
  }

  const observacoes = historico.filter(item => item.subId === sub.id).map(item => item.valor);
  if (observacoes.length < MINIMO_HISTORICO_ML) return undefined;
  const observado = METRICAS_MEDIA.has(sub.id) ? n / d : (pctDe(campo) ?? 0);
  const score = pontuarIsolationForest(observacoes, observado, sub.id);
  if (score < LIMIAR_ANOMALIA) return undefined;
  return warning(
    `O Isolation Forest identificou um valor atípico em relação ao histórico desta unidade (informado ${observado.toFixed(1)}). Confirme ou justifique.`,
    score,
    observacoes.length,
    'ml',
  );
}

export function analisarCampos(
  indicadores: MacroInd[],
  campos: Campos,
  historico: ObservacaoHistorica[] = [],
): ResultadoAnalise {
  const subsAtivos = indicadores.filter(indicador => indicador.ativo).flatMap(indicador => indicador.subs);
  const porId = new Map(subsAtivos.map(sub => [sub.id, sub]));
  const resultados: Record<string, ResultadoCampo> = {};

  for (const id of Object.keys(campos)) {
    if (!porId.has(id)) resultados[id] = invalid('Este subindicador não pertence à unidade ou à portaria vigente.');
  }
  for (const sub of subsAtivos) {
    const resultado = analisarSubindicador(sub, campos, historico);
    if (resultado) resultados[sub.id] = resultado;
  }

  return { modelo: MODELO, campos: resultados };
}

export function resultadoImpedeEnvio(resultado: ResultadoCampo | undefined, justificativa = ''): boolean {
  if (!resultado) return false;
  if (resultado.severidade === 'invalid') return true;
  return resultado.precisaJustificativa && justificativa.trim().length < 20;
}
