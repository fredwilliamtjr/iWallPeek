# iWallPeek

Imagens diárias do **Bing** e do **Windows Spotlight** como plano de fundo,
com janela de configurações em português e acesso pelo ícone perto do relógio.
Roda no **macOS**, no **Windows** e no **Linux (Ubuntu)** — a partir da 0.3.0 o app
é feito em Electron, a mesma tecnologia do [IRustPeek](https://github.com/fredwilliamtjr/IRustPeek).

## Instalar

Baixe o pacote da sua plataforma na [página de versões](https://github.com/fredwilliamtjr/iWallPeek/releases):

| Plataforma | Arquivo |
|---|---|
| macOS 11+ (Intel e Apple Silicon) | `iWallPeek-<versão>-universal.dmg` |
| Windows 10/11 | `iWallPeek.Setup.<versão>.exe` (instalador) ou `iWallPeek.<versão>.exe` (portátil) |
| Ubuntu/Debian | `iWallPeek-<versão>-amd64.deb` (ou `-arm64.deb`) |
| Outras distros Linux | `iWallPeek-<versão>-x86_64.AppImage` (ou `-arm64.AppImage`) |

O `SHA256SUMS.txt` de cada versão traz o checksum de todos os pacotes.

### macOS

Abra o DMG e arraste **iWallPeek** para **Aplicativos**. O app não é notarizado
pela Apple; se o macOS impedir a abertura, execute no Terminal **do Mac onde o
aplicativo foi instalado**:

```sh
xattr -dr com.apple.quarantine "/Applications/iWallPeek.app"
open "/Applications/iWallPeek.app"
```

O comando remove a quarentena somente do iWallPeek; não desativa o Gatekeeper.

### Windows

Rode o instalador. Sem assinatura de código, o SmartScreen pode mostrar
“O Windows protegeu o computador”: clique em **Mais informações › Executar assim mesmo**.
O ícone fica na área de notificação: clique esquerdo abre a janela, clique direito mostra o menu.

### Ubuntu

```sh
sudo apt install ./iWallPeek-<versão>-amd64.deb
```

Abra **iWallPeek** pelo menu de aplicativos. O ícone aparece nos indicadores do
painel superior. Para o AppImage: `chmod +x` no arquivo e execute; no Ubuntu 22.04+
ele precisa do `libfuse2` (`libfuse2t64` no 24.04) ou rode com `--appimage-extract-and-run`.
No GNOME puro (fora do Ubuntu), ative a extensão **AppIndicator** para ver o ícone.

## Configurações

- **Plano de fundo:** escolha Bing ou Windows Spotlight e atualize. No macOS, habilite todas as mesas.
- **Bing:** escolha a região, navegue nas oito imagens recentes disponibilizadas pelo serviço,
  visualize, salve manualmente ou aplique a imagem escolhida.
- **Windows Spotlight:** visualize a imagem atual e o histórico local das imagens obtidas pelo app.
- **Autossalvar:** cada serviço tem seu próprio interruptor e pasta. Desligar essa opção
  interrompe a exportação; o cache interno necessário para visualizar/aplicar continua existindo.
- **Tela de bloqueio:** no macOS e no Ubuntu acompanha o fundo da mesa; no Windows a
  tela de bloqueio é do próprio sistema e não é alterada.
- **Configurações:** início com o sistema e retenção de cache de 7, 30 ou 90 dias, com teto de 500 MiB.

Navegar no histórico não muda o papel de parede. Use **Usar como plano de fundo**.
O app verifica a mudança de dia a cada 15 minutos e ao acordar/desbloquear.
Pastas exportadas pelo usuário não são limpas pela retenção.

## Como o fundo é aplicado

| Sistema | Mecanismo |
|---|---|
| macOS | `NSWorkspace` em cada monitor (via JXA/`osascript`). No macOS 14+, “todas as mesas” grava a configuração global do WallpaperAgent (formato privado, conferido antes e com backup em `~/Library/Application Support/iWallPeek/WallpaperBackups`). Se o formato não for reconhecido, ou no macOS 13, o app reaplica a imagem na mesa ativa a cada minuto. |
| Windows | `SystemParametersInfo(SPI_SETDESKWALLPAPER)` via PowerShell, estilo **Preencher**, em todos os monitores. |
| Linux | GNOME/Ubuntu (`gsettings`, temas claro e escuro), KDE Plasma, XFCE, Cinnamon, MATE e LXQt/LXDE; `feh` como último recurso. |

Dados do app: `~/Library/Application Support/iWallPeek` (macOS),
`%APPDATA%\iWallPeek` (Windows) e `~/.config/iWallPeek` (Linux), com o cache em `Wallpapers/`.

## Compilar e testar

Requer Node.js 20+ e npm.

```sh
npm install
npm start                 # roda o app
npm test                  # testes (no macOS inclui a transformação das quatro mesas via JXA)
npm run test:live         # + feeds reais do Bing e do Spotlight
IWALLPEEK_DRY_RUN=1 npm start   # interface sem alterar o plano de fundo
```

Pacotes: `npm run build:mac:universal`, `npm run build:win` (num Windows) e
`npm run build:linux` (num Linux). O workflow `.github/workflows/release.yml` testa e
compila as três plataformas a cada push em `claude/**` e, numa tag `v*`, publica uma
pre-release com todos os pacotes e o `SHA256SUMS.txt`.

## Segurança e privacidade

HTTPS e lista permitida de domínios Microsoft, inclusive em cada redirecionamento;
sem cookies/cache persistente; metadados limitados a 2 MiB e imagens a 25 MiB;
validação JPEG/PNG (cabeçalho e decodificação real) e até 50 milhões de pixels.
Cache com nomes UUID e proteção contra links simbólicos. Exportação com nomes
controlados pelo app, sem sobrescrever arquivos diferentes. Comandos do sistema
são chamados sem shell, com o caminho da imagem como argumento. Janela com
isolamento de contexto, sandbox e Content Security Policy restrita.
Não há conta nem telemetria própria.

## Licença e origem

Derivado de DailyWalls (MIT). A configuração global de mesas do macOS usa a abordagem
de wallall (MIT). Veja LICENSE, NOTICE.md e THIRD_PARTY_LICENSES. Fotografias têm direitos próprios.
