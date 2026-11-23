# GratificAI

MVP para monitoramento e lançamento dos indicadores de desempenho da SESAU Recife. A aplicação em `mvp/` contém interface React, API Node.js e banco relacional PostgreSQL. Uma instalação nova começa sem unidades, contas de teste, nomes de pessoas ou resultados demonstrativos.

## Requisitos

- Node.js 22.18 ou superior (Node 24 recomendado para a conversão do SQLite).
- PostgreSQL 17 ou superior.
- npm.
- Docker Desktop aberto (para iniciar o PostgreSQL localmente pelo Compose).

## Iniciar localmente (Windows / PowerShell)

Use este modo para desenvolver e testar. Você precisa do Node.js, npm e Docker Desktop aberto. Os comandos abaixo devem ser executados na **raiz do projeto** (`GratificAI`), salvo quando indicado. Mantenha a mesma janela do PowerShell aberta durante a configuração inicial.

### 1. Iniciar o PostgreSQL

Na primeira execução, escolha uma senha para o banco. Se já iniciou o PostgreSQL antes, informe **a mesma senha**: alterar `POSTGRES_PASSWORD` no ambiente não muda a senha gravada no volume existente.

```powershell
$env:PG_PORT = "5433"
$senhaPostgres = Read-Host -Prompt "Crie a senha do PostgreSQL" -AsSecureString
$env:POSTGRES_PASSWORD = [System.Net.NetworkCredential]::new('', $senhaPostgres).Password
docker compose up -d --wait postgres
```

O Compose publica o PostgreSQL nessa porta do Windows e a encaminha para a porta `5432` do container. Se `5433` também estiver ocupada, escolha outra porta livre e use o mesmo valor em `PG_PORT` e `PGPORT`.

### 2. Instalar dependências e configurar a conexão

Vá para `mvp` antes destes comandos. Se o prompt já terminar em `\GratificAI\mvp`, não execute `cd mvp` outra vez. A aplicação deve usar a porta escolhida em `PG_PORT` (por exemplo, `5433`), não a porta interna `5432` do container.

```powershell
cd mvp
npm install

$env:PGHOST = "127.0.0.1"
$env:PGPORT = $env:PG_PORT
$env:PGDATABASE = "gratificai"
$env:PGUSER = "gratificai"
$env:PGPASSWORD = $env:POSTGRES_PASSWORD
```

Se o bootstrap retornar `password authentication failed for user "gratificai"`, a senha configurada no ambiente não corresponde à senha gravada no banco. Sem apagar o volume, redefina a senha pela sessão local do container. Na raiz do projeto (a variável `POSTGRES_PASSWORD` precisa estar definida para o Compose):

```powershell
Set-Location ..
docker compose exec -it postgres psql -U gratificai -d gratificai
```

No prompt do `psql` (que termina em `gratificai=#`), digite somente `\password gratificai`, informe a nova senha duas vezes e depois `\q`. Espere voltar ao prompt do PowerShell (`PS ...>`); **não digite comandos `$env:...`, `Read-Host` ou `Set-Location` dentro do `psql`**. De volta ao PowerShell, atualize as variáveis para a senha que acabou de criar e execute novamente o bootstrap:

```powershell
$senhaPostgres = Read-Host "Nova senha do PostgreSQL" -AsSecureString
$env:POSTGRES_PASSWORD = [System.Net.NetworkCredential]::new('', $senhaPostgres).Password
$env:PGPASSWORD = $env:POSTGRES_PASSWORD
Set-Location .\mvp
npm run db:bootstrap
```

Esse procedimento mantém os dados. Não use `docker compose down -v`.

### 3. Criar a conta CAM inicial (somente na primeira execução)

Use seu e-mail e crie uma senha com pelo menos 12 caracteres, incluindo maiúsculas, minúsculas e números:

```powershell
$env:BOOTSTRAP_CAM_EMAIL = Read-Host -Prompt "E-mail da conta CAM"
$senhaCAM = Read-Host -Prompt "Crie a senha inicial da CAM" -AsSecureString
$env:BOOTSTRAP_CAM_PASSWORD = [System.Net.NetworkCredential]::new('', $senhaCAM).Password
$env:BOOTSTRAP_CAM_NAME = "Administrador CAM"
npm run db:bootstrap

Remove-Item Env:BOOTSTRAP_CAM_EMAIL
Remove-Item Env:BOOTSTRAP_CAM_PASSWORD
Remove-Item Env:BOOTSTRAP_CAM_NAME
```

Uma execução bem-sucedida mostra `Conta CAM inicial provisionada.`. Se essa confirmação não aparecer, confira o erro no terminal antes de tentar entrar na aplicação. O bootstrap só deve ser executado uma vez, antes de existirem usuários. A senha CAM é temporária e deverá ser trocada no primeiro acesso.

Mantenha esta janela do PowerShell aberta: os comandos `docker compose` precisam de `$env:POSTGRES_PASSWORD`. Os `Remove-Item` acima removem somente as variáveis temporárias do bootstrap.

### 4. Iniciar a aplicação

```powershell
npm run dev
```

Abra **http://localhost:5173** no navegador. A interface encaminha as chamadas `/api` para o backend em `http://127.0.0.1:3001`. Para encerrar, volte ao terminal e pressione **Ctrl+C**.

### Iniciar novamente em outro dia

As variáveis configuradas no PowerShell não permanecem após fechar a janela. Abra uma nova janela, vá à raiz do projeto e execute:

```powershell
$env:PG_PORT = "5433"
$senhaPostgres = Read-Host -Prompt "Senha do PostgreSQL" -AsSecureString
$env:POSTGRES_PASSWORD = [System.Net.NetworkCredential]::new('', $senhaPostgres).Password
docker compose up -d --wait postgres

cd mvp
$env:PGHOST = "127.0.0.1"
$env:PGPORT = $env:PG_PORT
$env:PGDATABASE = "gratificai"
$env:PGUSER = "gratificai"
$env:PGPASSWORD = $env:POSTGRES_PASSWORD
npm run dev
```

Não execute `npm run db:bootstrap` novamente. Os cadastros e lançamentos permanecem no volume do PostgreSQL.

Para a hospedagem pública, não use `npm run dev`. Consulte [Executar em produção com Docker](#executar-em-produção-com-docker). O servidor exige `NODE_ENV=production`, `APP_ORIGIN` HTTPS e conexão PostgreSQL configurada.

## Converter os dados SQLite existentes

Para preservar uma instalação existente, faça backup do SQLite e configure a conexão PostgreSQL acima. **Execute a migração antes de criar a conta CAM**: pule a etapa 3 do início local, pois a migração copia os usuários existentes e exige que o destino ainda não tenha dados operacionais. Já dentro de `mvp/`, rode:

```powershell
npm run db:migrate:sqlite
```

O conversor lê `mvp/data/gratificai.sqlite` em modo somente leitura e copia distritos, unidades, usuários, sessões, portarias, configurações, lançamentos, histórico e auditoria. Para outro arquivo, defina `SQLITE_PATH`. A importação é cancelada se o destino PostgreSQL já tiver registros operacionais; a origem não é alterada. Verifique a cópia e mantenha o SQLite e seu backup até confirmar a migração.

Uma base PostgreSQL nova inicializa somente os oito distritos oficiais e as duas portarias padrão; novas unidades e usuários devem ser cadastrados pela CAM.

## Autenticação e segurança

Consulte [SEGURANCA.md](./SEGURANCA.md) para o inventário e classificação preliminares, matriz de riscos, fluxo RBAC, evidências, limitações e checklist de implantação. A validação institucional e o aceite dos riscos residuais continuam pendentes.

- Senhas armazenadas com scrypt e salt exclusivo; requisitos mínimos de complexidade e troca de senha autenticada.
- Sessões opacas no servidor, expiradas após oito horas; cookie `HttpOnly`, `SameSite=Strict`, `Secure` em produção.
- Tokens CSRF para operações mutáveis, verificação de origem configurada e limitação de tentativas de login.
- Perfil e escopo vêm exclusivamente da sessão validada no servidor; cabeçalhos e seletores do navegador não concedem permissões.
- Perfis distritais acessam somente unidades do seu distrito; perfis de unidade acessam somente a unidade associada; somente CAM parametriza e administra contas/unidades.
- Cabeçalhos de segurança, limites para requisições e validação de payloads; trilha de auditoria append-only pela aplicação, com usuário e timestamp.

Para produção, configure TLS num proxy reverso confiável, defina `APP_ORIGIN` para a origem HTTPS pública e `NODE_ENV=production`; o cookie passa a exigir HTTPS. Proteja o acesso ao PostgreSQL, habilite backups cifrados e controles operacionais. Integre SSO institucional antes de uso oficial e valide retenção, acesso e auditoria com a equipe de segurança e LGPD.

## Fluxo de submissão e revisão da CAM

Somente a conta vinculada à unidade preenche e submete seus indicadores. Após o envio, o lançamento passa para **Em Análise** e fica bloqueado para edição enquanto aguarda a CAM. No painel geral, a CAM pode revisar os indicadores e justificativas, então **aprovar** ou **devolver para ajustes** com parecer obrigatório de 20 a 1000 caracteres e prazo de resposta. A unidade pode salvar uma resposta de 20 a 1000 caracteres explicando as correções antes de reenviar; essa resposta fica visível à CAM na revisão seguinte. Parecer, prazo e resposta são persistidos no PostgreSQL e retornados no estado da API, inclusive após reiniciar o serviço. Após aprovado, o lançamento fica somente para leitura. Apenas dados aprovados entram no histórico usado pelo Isolation Forest; tentativas devolvidas não contaminam o treinamento.

## Nota e gratificação estimadas

O lançamento e o painel mostram a nota ponderada e a gratificação prevista conforme a portaria vigente: média dos percentuais dos subindicadores em cada macroindicador, ponderação pelos pesos do cargo/tipologia, aplicação do corte e do Vref, com fator específico para MAC ou cargos distritais. Enquanto houver respostas ausentes, a tela identifica a nota como parcial e considera esses campos sem pontuação. A estimativa é informativa e não substitui homologação nem cálculo oficial da CAM.

## Validação inteligente

A validação combina regras determinísticas com um Isolation Forest não supervisionado. Em cada análise, ajusta 100 árvores com até 32 amostras das últimas 50 submissões da mesma unidade e subindicador; só pontua anomalias com pelo menos 12 observações históricas. O índice de anomalia a partir de 0,65 gera um alerta para revisão, não uma probabilidade nem confirmação de erro. Valores matematicamente inválidos continuam bloqueados pelas regras; alertas podem ser justificados. O modelo não altera números e não garante a veracidade dos dados.

## Comandos

```powershell
cd mvp
npm test
npm run build
```

## Executar em produção com Docker

Este modo é para hospedagem, não para desenvolvimento local. Na raiz do projeto, configure a origem HTTPS pública e as senhas. Faça o bootstrap da conta CAM antes de iniciar a aplicação:

```powershell
$env:APP_ORIGIN = "https://gratificai.exemplo.gov.br"
$senhaPostgres = Read-Host -Prompt "Senha do PostgreSQL" -AsSecureString
$env:POSTGRES_PASSWORD = [System.Net.NetworkCredential]::new('', $senhaPostgres).Password
$env:BOOTSTRAP_CAM_EMAIL = Read-Host -Prompt "E-mail da conta CAM"
$senhaCAM = Read-Host -Prompt "Crie a senha inicial da CAM" -AsSecureString
$env:BOOTSTRAP_CAM_PASSWORD = [System.Net.NetworkCredential]::new('', $senhaCAM).Password
$env:BOOTSTRAP_CAM_NAME = "Administrador CAM"

docker compose build
docker compose run --rm -e BOOTSTRAP_CAM_EMAIL -e BOOTSTRAP_CAM_PASSWORD -e BOOTSTRAP_CAM_NAME api npm run db:bootstrap
Remove-Item Env:BOOTSTRAP_CAM_EMAIL
Remove-Item Env:BOOTSTRAP_CAM_PASSWORD
Remove-Item Env:BOOTSTRAP_CAM_NAME

docker compose up -d
```

O Compose mantém o PostgreSQL no volume `gratificai-postgres-data`, deixa a API na rede interna e publica o frontend apenas em `127.0.0.1:8080`. Configure um proxy TLS na frente do frontend. A porta PostgreSQL local também fica limitada a loopback; configure backup, retenção e criptografia antes de usar dados reais. Para mudar as portas locais, use `WEB_PORT` e `PG_PORT`.

O Compose constrói duas imagens: API Node e frontend Nginx. Se também quiser publicá-las no GHCR, autentique-se e envie as referências `latest`:

```powershell
docker login ghcr.io -u PauloCVT
docker compose build
docker compose push
```

O login solicita a credencial no terminal; não a inclua em comandos, ficheiros ou no repositório. As imagens publicadas são `ghcr.io/paulocvt/gratificai-api:latest` e `ghcr.io/paulocvt/gratificai-web:latest`.

Rotas principais: `GET /api/auth/setup`, `POST /api/auth/login`, `GET /api/auth/session`, `POST /api/auth/logout`, `POST /api/auth/password`, `GET /api/state`, operações de lançamento em `/api/unidades`, incluindo `POST /api/unidades/:id/review` (exclusiva da CAM), cadastro CAM em `/api/usuarios`, e parametrização em `/api/portarias`.
