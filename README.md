# iWallPeek

Aplicativo de barra de menus para macOS 13+, derivado do DailyWalls (MIT),
com wallpapers diários Bing/Windows Spotlight, interface pt-BR, início no login,
atualização a cada 15 minutos quando houver mudança de dia, ao acordar/desbloquear,
e retenção de 7/30/90 dias com teto de 500 MB.

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
Assinatura ad-hoc verificada, sem notarização Apple. Consulte TESTAR.md.

## Segurança

HTTPS e domínios Microsoft permitidos, inclusive em redirecionamentos;
sessão efêmera sem cookies/cache persistente; limite de 2 MB para metadados e 25 MB
para imagens; validação JPEG/PNG e limite de 50 milhões de pixels; nomes UUID locais;
rejeição de diretório com links simbólicos; limpeza restrita aos arquivos gerados.
AppleScript estático com caminho como argumento, sem interpolação ou shell.
Nenhuma alteração separada no fundo da tela de bloqueio/login.

## Licença e origem

Veja LICENSE e NOTICE.md. Fotografias têm direitos próprios.
