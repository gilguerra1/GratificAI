import { Profile, Screen } from '../domain';

export function Sidebar({
  screen, onNav, profile, mobileOpen, onClose,
}: {
  screen: Screen;
  onNav: (s: Screen) => void;
  profile: Profile;
  mobileOpen: boolean;
  onClose: () => void;
}) {
  const nav = [
    { id: 'dashboard' as Screen, icon: '⊞', label: 'Painel geral' },
    { id: 'indicadores' as Screen, icon: '⊟', label: 'Lançamento' },
    { id: 'motor' as Screen, icon: '⊙', label: 'Motor de regras', cam: true },
    { id: 'administracao' as Screen, icon: '⚙', label: 'Usuários e unidades', cam: true },
  ].filter(n => !n.cam || profile === 'cam');

  const sidebarClass = mobileOpen
    ? 'fixed inset-y-0 left-0 z-50 flex h-dvh w-64 shadow-xl lg:sticky lg:w-56 lg:shrink-0 lg:shadow-none'
    : 'hidden lg:sticky lg:flex lg:h-dvh lg:w-56 lg:shrink-0';

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label="Fechar menu"
          aria-controls="main-navigation"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden"
        />
      )}
      <aside id="main-navigation" className={`${sidebarClass} flex-col bg-[#0f172a]`}>
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10">
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 2L3 6v8l7 4 7-4V6L10 2z" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/><path d="M10 2v16M3 6l7 4 7-4" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/></svg>
            </div>
            <div>
              <p className="text-sm font-bold leading-tight text-white">GratificAI</p>
              <p className="mt-0.5 text-[10px] text-white/55">SESAU Recife</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar menu" className="rounded-md px-2 py-1 text-white/70 hover:bg-white/10 lg:hidden">✕</button>
        </div>
        <nav aria-label="Navegação principal" className="flex-1 space-y-1 px-3 py-4">
          {nav.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => onNav(item.id)}
              aria-current={screen === item.id ? 'page' : undefined}
              className={`flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium transition-colors
                ${screen === item.id ? 'bg-white/15 text-white' : 'text-white/65 hover:bg-white/10 hover:text-white'}`}
            >
              <span aria-hidden="true" className="w-5 text-center text-base">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="border-t border-white/10 px-4 py-4">
          <p className="text-xs font-medium text-white/70">Prefeitura do Recife</p>
          <p className="mt-1 text-[10px] text-white/45">Secretaria de Saúde</p>
        </div>
      </aside>
    </>
  );
}
