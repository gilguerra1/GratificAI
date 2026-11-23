# Segurança da Informação — GratificAI

## Escopo e situação

Este documento consolida o levantamento preliminar e as evidências técnicas do MVP. A classificação de dados e a análise de riscos são hipóteses de trabalho, não parecer jurídico nem aprovação para produção. A validação pelo responsável institucional por segurança, privacidade/LGPD e representantes das áreas usuárias continua necessária.

O MVP foi definido para receber somente dados agregados. A tela de lançamento alerta para não inserir nomes, documentos, prontuários ou outros identificadores em justificativas. Indicadores ou justificativas que permitam identificar trabalhadores ou revelar informação de saúde devem ser tratados como dados pessoais sensíveis até revisão formal.

O detector de anomalias é um Isolation Forest não supervisionado, ajustado por unidade e subindicador com até 50 submissões anteriores aprovadas; só pontua após 12 observações. O índice é heurístico, não uma probabilidade nem decisão automática. A planilha sintética enviada para análise não é usada no modelo.

## Atores e controle de acesso

O perfil é atribuído pela CAM e validado no servidor com a sessão; dados enviados pelo navegador não definem permissões.

| Perfil | Escopo de dados | Permissões principais |
|---|---|---|
| CAM | Rede completa | Consultar dados; cadastrar unidades e contas; administrar contas; parametrizar portarias |
| GG, SnA, SnB1, SnB2 | Unidades do distrito associado | Consultar e lançar indicadores do distrito |
| USF, CAPS, CECON, MAC | Unidade associada | Consultar e lançar indicadores da própria unidade |

O escopo por distrito/unidade é conferido também nas rotas de escrita. A interface não é uma fronteira de segurança.

## Inventário e classificação preliminar

| Dados | Classificação de trabalho | Tratamento existente / necessário |
|---|---|---|
| Nome, e-mail, perfil e vínculo institucional | Pessoal — restrito | Acesso por sessão e escopo; coletar somente o necessário |
| Senhas | Segredo de autenticação — altamente restrito | Nunca persistir senha em claro; scrypt com salt exclusivo; segredo de bootstrap fornecido por ambiente e removido após o uso |
| Indicadores agregados e lançamentos | Institucional confidencial; potencialmente pessoal/sensível se reidentificável | Restringir por perfil/unidade; não incluir dados identificáveis de pacientes; avaliar granularidade e justificativas com o encarregado |
| Sessões e tokens CSRF | Segredo operacional — altamente restrito | Token de sessão aleatório, somente hash no banco; cookie HttpOnly, SameSite=Strict e Secure em produção |
| Auditoria e logs técnicos | Restrito | Não registrar senhas, cookies, corpos de requisição nem textos de justificativa; limitar acesso e retenção no ambiente de execução |
| Backup PostgreSQL e arquivo SQLite legado | Mesma classificação do banco, ou mais restritiva | Criptografar, restringir acesso, testar restauração e definir retenção antes da produção |

Finalidade, base legal, papéis de controlador/operador, retenção, atendimento a titulares e procedimento de incidente devem ser confirmados pela instituição antes do uso oficial.

## Matriz preliminar de riscos

Escala qualitativa: probabilidade e impacto baixos, médios ou altos. O risco residual depende de operação e configuração; não representa certificação.

| Risco | Prob. / impacto | Controles existentes | Risco residual / ação |
|---|---|---|---|
| Uso indevido de conta ou senha inicial exposta | Média / Alto | Hash scrypt; senha forte; troca obrigatória da senha inicial; bloqueio temporário de tentativas de login | Médio. Usar gestor de segredos, canal seguro para credenciais e revisar/desativar contas |
| Acesso a dados fora do distrito/unidade | Média / Alto | Sessão validada no servidor; autorização por perfil e escopo nas leituras e escritas; testes automatizados | Baixo a médio. Validar todos os perfis e limites de escopo com usuários institucionais |
| Roubo de sessão ou CSRF | Média / Alto | Cookie HttpOnly, SameSite=Strict, Secure em produção; token CSRF; checagem de origem | Médio. TLS e configuração correta do proxy são pré-requisitos operacionais |
| Exposição ou perda do PostgreSQL/backup | Média / Alto | PostgreSQL com conexão configurada por ambiente; API usa parâmetros SQL; serviço sem porta pública no Compose | Alto sem controles operacionais. Restringir rede e credenciais, criptografar backups, monitorar acesso e testar restauração |
| Reidentificação por indicadores ou justificativas | Média / Alto | Acesso restrito; validação de entradas; auditoria não replica o texto das justificativas | Médio. Não inserir identificadores; avaliar agregação, necessidade e retenção com privacidade/LGPD |
| Abuso de indisponibilidade ou muitas requisições | Média / Médio | Limite de tamanho do corpo e rate limit básico de login | Médio. Rate limit é em memória e por instância; aplicar limite compartilhado/proxy e monitoramento se houver múltiplas instâncias |
| Alteração ou exclusão de trilha de auditoria | Baixa / Alto | Triggers impedem update/delete via aplicação; operações registradas com usuário e data | Médio/alto contra administrador do host/banco. Exportar para armazenamento de logs controlado e protegido contra alteração |
| Erros ou logs revelarem informação | Baixa / Alto | Respostas genéricas para falhas internas; logs de acesso estruturados sem IP, corpo ou credenciais | Baixo a médio. Definir retenção, acesso e revisão de logs na implantação |

## Alternativas avaliadas

| Alternativa | Vantagens | Riscos / adequação |
|---|---|---|
| PostgreSQL, banco ativo do MVP | Banco relacional concorrente, adequado a múltiplas conexões e persistência por volume | Exige serviço, credenciais, backup, atualizações e controles de rede |
| Banco relacional gerenciado | Controles de acesso, backup e operação centralizados podem ser integrados à infraestrutura institucional | Exige configuração, custo, gestão de credenciais, revisão de fornecedor e validação de residência/transferência de dados |
| Planilhas ou arquivos compartilhados | Baixo custo inicial e fácil adoção | Controle de acesso granular, auditoria, consistência e retenção mais frágeis; inadequado para os dados e perfis previstos |

O PostgreSQL é o banco ativo. A instalação Compose mantém os dados num volume persistente; operação de produção deve ser validada com as equipes institucionais de infraestrutura e segurança.

## Fluxo de autenticação e autorização

1. A CAM inicial é provisionada localmente por `npm run db:bootstrap`; não há conta padrão nem cadastro público.
2. O servidor valida e-mail/senha, compara o hash scrypt e cria sessão opaca aleatória. No banco fica somente o hash do token de sessão.
3. O navegador recebe cookie HttpOnly, SameSite=Strict e, em produção, Secure. O token CSRF é retornado à aplicação e enviado nas operações mutáveis.
4. Em cada requisição protegida, o backend valida sessão, validade, estado ativo da conta e eventual troca obrigatória de senha.
5. O backend obtém o perfil e o escopo do registro da sessão e autoriza a operação no servidor. A CAM tem escopo global; perfis distritais e de unidade são limitados ao vínculo cadastrado.
6. Logout, alteração de senha e desativação de usuário revogam sessões conforme necessário. Eventos relevantes são registrados na tabela de auditoria.

## Requisitos e evidências

| Requisito do documento | Situação | Evidência / pendência |
|---|---|---|
| Mapear atores, dados sensíveis e requisitos LGPD | Parcial | Inventário e perfis acima são preliminares; encarregado/jurídico deve confirmar classificação, finalidade e base legal |
| Identificar riscos | Parcial | Matriz preliminar acima; precisa revisão institucional e aceite de risco residual |
| Comparar alternativas | Parcial | Comparação acima; confirmar arquitetura de produção com infraestrutura |
| Incorporar autenticação, autorização e proteção de dados | Implementado no MVP | `mvp/server/app.mjs`; testes de sessão, escopo, CSRF, senha e validação em `mvp/server/app.test.mjs` |
| Documentar autenticação/RBAC e segredos | Implementado no MVP | Fluxo acima; instruções de bootstrap e configuração no `README.md` |
| Conferir controles existentes e pendentes | Parcial | Checklist deste documento; itens operacionais e validação formal ainda pendentes |
| Login e controle de perfis | Implementado no MVP | Testes automatizados de login, acesso sem sessão, impersonação e escopo |
| Validar entradas e proteger credenciais | Implementado no MVP | Limite de corpo, validação de campos, SQL parametrizado, scrypt e teste para senha excessivamente longa |
| Logs de acesso, erros e rate limit básico | Implementado parcialmente | Log estruturado de método/rota/status/duração; erros internos retornam mensagem genérica; limite de login em memória. Produção multi-instância precisa controle compartilhado |
| Corrigir não conformidades identificadas | Implementado neste ciclo | Logs não incluem IDs específicos, credenciais ou corpos; auditoria do lançamento guarda IDs de indicadores justificados, não o texto da justificativa; senha de login acima de 256 caracteres não é processada pelo scrypt |
| Validar controles com usuários/cliente | Pendente | Requer sessão de validação com stakeholders; não pode ser atestada por testes automatizados |
| Consolidar limitações, testes e riscos residuais | Parcial | Documento atual; preencher resultado da validação institucional e configurações reais de implantação |
| Demonstrar controles | Pendente | Executar demonstração com stakeholders, registrar participantes, cenários, resultados, aceite e ações corretivas |

## Testes de segurança do MVP

O conjunto automatizado deve ser executado em `mvp/` com `npm test` e `npm run build`. Os testes cobrem, entre outros:

- ausência de acesso sem sessão e resistência a perfil forjado pelo cliente;
- autenticação, cookie, bloqueio temporário de tentativas e troca obrigatória de senha;
- exigência de CSRF e rejeição de origem não permitida;
- isolamento por distrito/unidade e administração exclusiva da CAM;
- registro de acesso sem corpo/credenciais e minimização dos detalhes de auditoria;
- persistência de lançamentos e revogação de sessões.

Esses testes não substituem teste de penetração, revisão de configuração do servidor, validação legal, teste de recuperação de backup ou aceite do cliente.

## Checklist obrigatório antes de produção

- [ ] Hospedar atrás de TLS válido; definir `NODE_ENV=production` e `APP_ORIGIN` como origem HTTPS.
- [ ] Configurar a conexão PostgreSQL, persistência e backup; manter API e banco inacessíveis diretamente à Internet e encaminhar `/api` por proxy TLS.
- [ ] Restringir permissões do banco e do host; criptografar backups e testar restauração.
- [ ] Guardar segredos em gestor apropriado; nunca versionar `.env`, credenciais ou banco com dados reais.
- [ ] Definir controlador/operador, base legal, finalidade, minimização, retenção, descarte, direitos e resposta a incidentes com o encarregado/LGPD.
- [ ] Aprovar perfis e testar acesso com representantes de cada papel e distrito/unidade.
- [ ] Definir monitoramento, retenção e acesso aos logs; considerar rate limit compartilhado para múltiplas instâncias.
- [ ] Aplicar os prazos e requisitos institucionais de retenção/backup no provedor de hospedagem; os valores e o provedor ainda não foram informados para esta implantação.
- [ ] Validar dependências, infraestrutura, política de atualização e plano de continuidade.
- [ ] Registrar demonstração, aceite e riscos residuais pelo cliente/equipe de segurança.

**Limitação:** criptografia de backup, SSO institucional e rate limit distribuído dependem da infraestrutura e não são fornecidos pela aplicação. Não declarar conformidade LGPD ou prontidão para produção sem fechar os itens aplicáveis acima e obter aprovação institucional.
