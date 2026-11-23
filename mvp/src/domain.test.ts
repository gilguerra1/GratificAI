import { describe, expect, it } from 'vitest';
import {
  Campos, buildIndicadores, calcularNotaGratificacao, indicadoresDaUnidade, pctDe, pesosPadrao, pesosValidos,
  portariasIniciais,
} from './domain';
import { analisarCampos, resultadoImpedeEnvio } from './ml';

const unidade = {
  id: 1, nome: 'Unidade de teste', tipo: 'USF', distrito: 'DS I', status: 'Pendente' as const,
  preenchimento: 0, nota: null, gratificacaoEsperada: null, notaCompleta: false,
};

describe('Indicadores e regras de domínio', () => {
  it('monta os subindicadores operacionais da USF sem depender de registros de demonstração', () => {
    expect(indicadoresDaUnidade(unidade, pesosPadrao())[3].subs).toHaveLength(11);
  });

  it('exige pesos que somem 100% em cada linha', () => {
    const pesos = pesosPadrao();
    expect(pesosValidos(pesos)).toBe(true);
    pesos.usf = [20, 20, 20, 30, 0];
    expect(pesosValidos(pesos)).toBe(false);
  });

  it('não ativa indicadores sem peso', () => {
    expect(buildIndicadores('usf', [20, 20, 20, 40, 0])[4].ativo).toBe(false);
    expect(buildIndicadores('usf', [20, 20, 20, 20, 20])[4].subs).toHaveLength(3);
  });

  it('não interpreta texto parcial como número e aceita decimal com vírgula', () => {
    expect(pctDe({ n: '10abc', d: '20' })).toBeNull();
    expect(pctDe({ n: '0x10', d: '20' })).toBeNull();
    expect(pctDe({ n: '1,5', d: '3' })).toBe(50);
    expect(pctDe({ n: '1e308', d: '1e-308' })).toBeNull();
  });

  it('calcula nota ponderada e gratificação estimada, aplicando o corte da portaria', () => {
    const campos: Campos = Object.fromEntries(
      indicadoresDaUnidade(unidade, pesosPadrao()).flatMap(indicador => indicador.subs.map(sub => [
        sub.id, sub.id === '2.2' ? { n: '0', d: '10' } : { n: '8', d: '10' },
      ])),
    );
    const resultado = calcularNotaGratificacao(unidade, campos, portariasIniciais()[0]);
    expect(resultado).toEqual({ nota: 76, gratificacaoEsperada: 3648, completa: true });
    expect(calcularNotaGratificacao(unidade, campos, portariasIniciais()[0], 'gg').gratificacaoEsperada).toBe(3939.84);

    const parcial = calcularNotaGratificacao(unidade, { '1.1': { n: '8', d: '10' } }, portariasIniciais()[0]);
    expect(parcial).toEqual({ nota: 16, gratificacaoEsperada: 0, completa: false });
  });
});

describe('Validação inteligente dos lançamentos', () => {
  const indicadores = indicadoresDaUnidade(unidade, pesosPadrao());

  it('bloqueia razões impossíveis, inclusive no fluxo de submissão', () => {
    const campos: Campos = { '4.1.1': { n: '12', d: '10' } };
    const resultado = analisarCampos(indicadores, campos).campos['4.1.1'];
    expect(resultado.severidade).toBe('invalid');
    expect(resultadoImpedeEnvio(resultado)).toBe(true);
  });

  it('sinaliza uma anomalia após treinar com 12 observações anteriores', () => {
    const campos: Campos = { '4.1.1': { n: '1', d: '10' } };
    const historico = Array.from({ length: 12 }, () => ({ subId: '4.1.1', valor: 90 }));
    const resultado = analisarCampos(indicadores, campos, historico).campos['4.1.1'];
    expect(resultado.severidade).toBe('warning');
    expect(resultado.origem).toBe('ml');
    expect(resultado.observacoesHistoricas).toBe(12);
    expect(resultadoImpedeEnvio(resultado)).toBe(true);
    expect(resultadoImpedeEnvio(resultado, 'Auditoria confirmou alteração na população elegível.')).toBe(false);
  });

  it('não sinaliza uma observação normal e aguarda histórico mínimo para o Isolation Forest', () => {
    const campos: Campos = { '4.1.1': { n: '8', d: '10' } };
    const historico = Array.from({ length: 12 }, () => ({ subId: '4.1.1', valor: 80 }));
    expect(analisarCampos(indicadores, campos, historico).campos['4.1.1']).toBeUndefined();

    const historicoInsuficiente = historico.slice(0, 3);
    expect(analisarCampos(indicadores, { '4.1.1': { n: '1', d: '10' } }, historicoInsuficiente).campos['4.1.1']).toBeUndefined();
  });

  it('sinaliza ausência total de requisições e exige justificativa técnica', () => {
    const resultado = analisarCampos(indicadores, { '1.1': { n: '0', d: '12' } }).campos['1.1'];
    expect(resultado.severidade).toBe('warning');
    expect(resultadoImpedeEnvio(resultado, '')).toBe(true);
  });
});
