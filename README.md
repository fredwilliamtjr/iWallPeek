# iWallPeek

Aplicativo para macOS 13+ com imagens diárias do Bing e Windows Spotlight,
janela de configurações em português e acesso pela barra de menus.

## Instalar

Baixe o DMG na [página de versões](https://github.com/fredwilliamtjr/iWallPeek/releases),
abra e arraste **iWallPeek** para **Aplicativos**.

Esta versão tem assinatura ad-hoc e não é notarizada pela Apple. Se o macOS
impedir a abertura, execute no Terminal **do Mac onde o aplicativo foi instalado**:

```sh
xattr -dr com.apple.quarantine "/Applications/iWallPeek.app"
open "/Applications/iWallPeek.app"
```

O comando remove a quarentena somente do iWallPeek; não desativa o Gatekeeper.
Use-o para o aplicativo obtido neste repositório.

## Configurações

- **Plano de fundo:** escolha Bing ou Windows Spotlight, atualize e habilite todas as mesas.
- **Bing:** escolha a região, navegue nas oito imagens recentes disponibilizadas pelo serviço,
  visualize, salve manualmente ou aplique a imagem escolhida.
- **Windows Spotlight:** visualize a imagem atual e o histórico local das imagens obtidas pelo app.
- **Autossalvar:** cada serviço tem seu próprio interruptor e pasta. Desligar essa opção
  interrompe a exportação; o cache interno necessário para visualizar/aplicar continua existindo.
- **Tela de bloqueio:** acompanha o fundo da mesa conforme o comportamento do macOS.
  Esta versão não oferece uma fonte independente nem altera a tela de login após reiniciar.
- **Geral:** início no login e retenção de cache de 7, 30 ou 90 dias, com teto de 500 MiB.

Navegar no histórico não muda o papel de parede. Use **Usar como plano de fundo**.
O app verifica a mudança de dia a cada 15 minutos e ao acordar/desbloquear.
Pastas exportadas pelo usuário não são limpas pela retenção.

## Todas as mesas

No macOS 14+, o app tenta atualizar a configuração global do WallpaperAgent.
Este formato é privado do macOS: a estrutura é conferida antes da gravação,
com backup em `~/Library/Application Support/iWallPeek/WallpaperBackups`.
Configurações existentes de mesas, monitores e protetor de tela são preservadas.
Se o formato não for reconhecido, ou no macOS 13, o app reaplica o fundo ao trocar de mesa.
A interface informa o modo utilizado. A aplicação simultânea nas quatro mesas
precisa de homologação no MacBook; veja [TESTAR.md](TESTAR.md).

## Compilar e verificar

Requer Swift 5.10+ e Command Line Tools. Sem dependências externas.

```sh
./scripts/verify.sh
IWALLPEEK_LIVE_TEST=1 ./scripts/verify.sh
./build.sh arm64
# Opcional para Macs Intel:
./build.sh x86_64
```

Saída em `dist/`: aplicativo, DMG e checksum. Build não instala nem abre o app.

## Segurança e privacidade

HTTPS e lista permitida de domínios Microsoft, inclusive em redirecionamentos;
sessão efêmera sem cookies/cache persistente; metadados limitados a 2 MiB e imagens
limitadas a 25 MiB; validação JPEG/PNG e até 50 milhões de pixels.
Cache com nomes UUID e proteção contra links simbólicos. Exportação com nomes
controlados pelo app, sem sobrescrever arquivos diferentes. Pastas escolhidas
são lembradas com bookmarks do macOS. Não há conta nem telemetria própria.

## Licença e origem

Derivado de DailyWalls (MIT). A configuração global de mesas usa a abordagem de
wallall (MIT). Veja LICENSE, NOTICE.md e THIRD_PARTY_LICENSES. Fotografias têm direitos próprios.
