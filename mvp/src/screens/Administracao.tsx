import { FormEvent, useState } from 'react';
import { PROFILE_ORDER, Profile, PROFILES, TIPOS_UNIDADE } from '../domain';
import { ApiError } from '../api';
import { alterarStatusUsuario, criarUnidade, criarUsuario, useStore } from '../store';

const classeInput = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400';

export function AdministracaoScreen() {
  const st = useStore();
  const [mensagem, setMensagem] = useState('');
  const [unidade, setUnidade] = useState({ nome: '', tipo: TIPOS_UNIDADE[0] as string, distrito: st.distritos[0]?.id ?? '' });
  const [usuario, setUsuario] = useState({
    nome: '', email: '', senha: '', perfil: 'usf' as Profile,
    distrito: st.distritos[0]?.id ?? '', unidadeId: 0,
  });
  const distritoRole = ['gg', 'sna', 'snb1', 'snb2'].includes(usuario.perfil);
  const unidadeRole = ['usf', 'caps', 'cecon', 'mac'].includes(usuario.perfil);
  const unidadesCompatíveis = st.unidades.filter(item => {
    if (usuario.perfil === 'usf') return ['USF', 'UBT', 'UBT MISTA', 'UCIS', 'SAE', 'NDI'].includes(item.tipo);
    if (usuario.perfil === 'caps') return item.tipo === 'CAPS';
    if (usuario.perfil === 'cecon') return ['CECON', 'CECO'].includes(item.tipo);
    if (usuario.perfil === 'mac') return item.tipo === 'MAC';
    return false;
  });

  const criarCadastroUnidade = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await criarUnidade(unidade.nome, unidade.tipo, unidade.distrito);
      setUnidade(current => ({ ...current, nome: '' }));
      setMensagem('Unidade cadastrada.');
    } catch (error) {
      setMensagem(error instanceof ApiError ? error.message : 'Falha ao cadastrar unidade.');
    }
  };

  const criarConta = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await criarUsuario({
        ...usuario,
        ...(distritoRole ? {} : { distrito: undefined }),
        ...(unidadeRole ? {} : { unidadeId: undefined }),
      });
      setUsuario(current => ({ ...current, nome: '', email: '', senha: '' }));
      setMensagem('Conta criada. Compartilhe a senha inicial por um canal seguro e solicite a troca no primeiro acesso.');
    } catch (error) {
      setMensagem(error instanceof ApiError ? error.message : 'Falha ao criar a conta.');
    }
  };

  const alternarConta = async (id: string, ativo: boolean) => {
    try {
      await alterarStatusUsuario(id, !ativo);
      setMensagem(ativo ? 'Conta desativada e sessões encerradas.' : 'Conta reativada.');
    } catch (error) {
      setMensagem(error instanceof Error ? error.message : 'Falha ao alterar a conta.');
    }
  };

  return (
    <div className="space-y-5 p-5">
      <header>
        <h1 className="text-xl font-bold text-slate-900">Usuários e unidades</h1>
        <p className="mt-1 text-xs text-slate-500">Cadastros reais da base. A permissão é definida no servidor pelo perfil e pelo escopo associado à conta.</p>
      </header>
      {mensagem && <p role="status" className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">{mensagem}</p>}

      <section className="grid gap-5 xl:grid-cols-2">
        <form onSubmit={criarCadastroUnidade} className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-bold text-slate-800">Cadastrar unidade</h2>
          <label className="mt-4 block text-xs font-semibold text-slate-700">Nome da unidade
            <input required maxLength={160} value={unidade.nome} onChange={event => setUnidade({ ...unidade, nome: event.target.value })} className={classeInput} />
          </label>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-700">Tipologia
              <select value={unidade.tipo} onChange={event => setUnidade({ ...unidade, tipo: event.target.value })} className={classeInput}>
                {TIPOS_UNIDADE.map(tipo => <option key={tipo}>{tipo}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-700">Distrito
              <select value={unidade.distrito} onChange={event => setUnidade({ ...unidade, distrito: event.target.value })} className={classeInput}>
                {st.distritos.map(distrito => <option key={distrito.id} value={distrito.id}>{distrito.nome}</option>)}
              </select>
            </label>
          </div>
          <button disabled={!unidade.nome.trim()} className="mt-4 rounded-lg bg-[#0f172a] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">Adicionar unidade</button>
        </form>

        <form onSubmit={criarConta} className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-bold text-slate-800">Criar conta de acesso</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-700">Nome completo
              <input required maxLength={120} value={usuario.nome} onChange={event => setUsuario({ ...usuario, nome: event.target.value })} className={classeInput} />
            </label>
            <label className="text-xs font-semibold text-slate-700">E-mail institucional
              <input required type="email" autoComplete="off" value={usuario.email} onChange={event => setUsuario({ ...usuario, email: event.target.value })} className={classeInput} />
            </label>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-700">Perfil operacional
              <select value={usuario.perfil} onChange={event => setUsuario({ ...usuario, perfil: event.target.value as Profile, unidadeId: 0 })} className={classeInput}>
                {PROFILE_ORDER.map(perfil => <option key={perfil} value={perfil}>{PROFILES[perfil].label}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-700">Senha inicial
              <input required type="password" autoComplete="new-password" minLength={12} value={usuario.senha} onChange={event => setUsuario({ ...usuario, senha: event.target.value })} className={classeInput} />
              <span className="mt-1 block text-[10px] font-normal text-slate-400">Mínimo de 12 caracteres, maiúscula, minúscula e número.</span>
            </label>
          </div>
          {distritoRole && <label className="mt-3 block text-xs font-semibold text-slate-700">Distrito autorizado
            <select value={usuario.distrito} onChange={event => setUsuario({ ...usuario, distrito: event.target.value })} className={classeInput}>
              {st.distritos.map(distrito => <option key={distrito.id} value={distrito.id}>{distrito.nome}</option>)}
            </select>
          </label>}
          {unidadeRole && <label className="mt-3 block text-xs font-semibold text-slate-700">Unidade autorizada
            <select required value={usuario.unidadeId} onChange={event => setUsuario({ ...usuario, unidadeId: Number(event.target.value) })} className={classeInput}>
              <option value={0}>Selecione uma unidade</option>
              {unidadesCompatíveis.map(item => <option key={item.id} value={item.id}>{item.nome} · {item.distrito}</option>)}
            </select>
            {!unidadesCompatíveis.length && <span className="mt-1 block text-[10px] font-normal text-amber-700">Cadastre primeiro uma unidade compatível.</span>}
          </label>}
          <button disabled={!usuario.nome.trim() || !usuario.email.trim() || usuario.senha.length < 12 || (unidadeRole && !usuario.unidadeId)}
            className="mt-4 rounded-lg bg-[#0f172a] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">Criar conta</button>
        </form>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-bold text-slate-800">Contas cadastradas</h2>
        </div>
        {st.users.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead><tr className="border-b border-slate-100 text-[9px] uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">Usuário</th><th className="px-4 py-3">Perfil</th><th className="px-4 py-3">Escopo</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3">Ação</th>
              </tr></thead>
              <tbody>{st.users.map(item => (
                <tr key={item.id} className="border-b border-slate-50 text-xs">
                  <td className="px-4 py-3"><p className="font-semibold text-slate-800">{item.nome}</p><p className="text-[10px] text-slate-400">{item.email}</p></td>
                  <td className="px-4 py-3">{PROFILES[item.perfil].sigla}</td>
                  <td className="px-4 py-3">{item.distrito ?? (item.unidadeId ? st.unidades.find(unit => unit.id === item.unidadeId)?.nome ?? `Unidade ${item.unidadeId}` : 'Rede')}</td>
                  <td className="px-4 py-3">{item.ativo ? 'Ativa' : 'Desativada'}</td>
                  <td className="px-4 py-3"><button onClick={() => { void alternarConta(item.id, item.ativo); }} disabled={item.id === st.user.id}
                    className="text-[10px] font-semibold text-rose-700 disabled:text-slate-300">{item.ativo ? 'Desativar' : 'Reativar'}</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="px-5 py-6 text-xs text-slate-500">Nenhuma conta foi cadastrada.</p>}
      </section>
    </div>
  );
}
