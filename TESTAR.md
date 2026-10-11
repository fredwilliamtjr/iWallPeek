iWallPeek 0.1.0 — teste no macOS 13 ou superior

1. Abra o DMG e arraste iWallPeek para Aplicativos.
2. Abra o app. Esta versão de teste tem assinatura ad-hoc, sem notarização Apple.
   Se o macOS bloquear, use Ajustes do Sistema > Privacidade e Segurança > Abrir Mesmo Assim.
   Não é necessário desativar o Gatekeeper nem remover atributos via Terminal.
3. No ícone de foto da barra de menus, selecione Bing e depois Atualizar agora.
4. Confira a imagem no desktop. Troque para Windows Spotlight e repita.
5. Para todos os Spaces, autorize Automação para System Events quando solicitado.
6. Bloqueie o Mac (Control + Command + Q) e confira o fundo. A tela de bloqueio
   depende do macOS e não é configurada separadamente pelo app; a tela inicial
   de login após reiniciar não é prometida como parte desse recurso.
7. Marque Iniciar com o macOS e confira em Ajustes > Geral > Itens de Início.
8. Escolha retenção de 7, 30 ou 90 dias. O teto adicional é 500 MB; a imagem atual é preservada.
9. Sem internet, o app informa erro no menu e mantém o papel de parede anterior.

O app consulta os serviços Microsoft e envia idioma/região. Não tem conta nem
telemetria própria. Imagens ficam em ~/Library/Application Support/iWallPeek/Wallpapers.
A desinstalação é feita encerrando o app, desmarcando início no login e removendo
somente iWallPeek.app. As imagens podem ser removidas depois, pela pasta do app.
