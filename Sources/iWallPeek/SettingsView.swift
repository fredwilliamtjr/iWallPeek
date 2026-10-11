import SwiftUI
import ServiceManagement

enum Panel: String, CaseIterable, Identifiable {
    case wallpaper, lockScreen, bing, spotlight, general
    var id: String { rawValue }
    var title: String {
        switch self {
        case .wallpaper: return "Plano de fundo"
        case .lockScreen: return "Tela de bloqueio"
        case .bing: return "Imagem diária do Bing"
        case .spotlight: return "Windows Spotlight"
        case .general: return "Configurações"
        }
    }
    var icon: String {
        switch self {
        case .wallpaper: return "desktopcomputer"
        case .lockScreen: return "lock.display"
        case .bing: return "globe.americas"
        case .spotlight: return "sparkles"
        case .general: return "gearshape"
        }
    }
}

struct SettingsView: View {
    @ObservedObject var model: WallModel
    @State private var panel: Panel? = .wallpaper
    init(model: WallModel, initialPanel: Panel = .wallpaper) {
        self.model = model
        _panel = State(initialValue: initialPanel)
    }
    var body: some View {
        NavigationSplitView {
            VStack(alignment: .leading, spacing: 18) {
                Label("iWallPeek", systemImage: "photo.on.rectangle.angled")
                    .font(.title2.bold()).padding(.horizontal, 16).padding(.top, 20)
                List(selection: $panel) {
                    ForEach(Panel.allCases) { item in Label(item.title, systemImage: item.icon).tag(item) }
                }.listStyle(.sidebar).disabled(model.busy)
                Text("Versão 0.2.0").font(.caption).foregroundStyle(.secondary).padding(16)
            }.navigationSplitViewColumnWidth(min: 200, ideal: 225, max: 270)
        } detail: {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text((panel ?? .wallpaper).title).font(.largeTitle.bold())
                    Spacer()
                    if model.busy { ProgressView().controlSize(.small) }
                }.padding(24)
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        switch panel ?? .wallpaper {
                        case .wallpaper: wallpaper
                        case .lockScreen: lockScreen
                        case .bing: service(.bing)
                        case .spotlight: service(.spotlight)
                        case .general: general
                        }
                    }.padding(.horizontal, 24).padding(.bottom, 24).frame(maxWidth: .infinity, alignment: .leading)
                }
                Divider()
                Text(model.status).font(.caption).foregroundStyle(.secondary)
                    .lineLimit(4).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding(12)
            }
        }
        .frame(minWidth: 900, minHeight: 680)
        .onChange(of: panel) { value in
            if value == .bing { model.loadCatalog(.bing) }
            if value == .spotlight { model.loadCatalog(.spotlight) }
        }
    }
    private func photo(_ image: NSImage?, height: CGFloat = 300) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12).fill(Color.primary.opacity(0.045))
            if let image { Image(nsImage: image).resizable().scaledToFit().padding(6) }
            else {
                VStack(spacing: 12) {
                    Image(systemName: "photo").font(.system(size: 42)).foregroundStyle(.secondary)
                    Text(model.busy ? "Carregando imagem…" : "Nenhuma imagem selecionada").foregroundStyle(.secondary)
                }
            }
        }.frame(height: height).clipShape(RoundedRectangle(cornerRadius: 12))
    }
    private var wallpaper: some View {
        VStack(alignment: .leading, spacing: 20) {
            photo(model.currentPreview)
            Text(model.currentTitle).font(.headline).textSelection(.enabled)
            if let current = model.currentSource { Text("Imagem aplicada: " + current.title).foregroundStyle(.secondary) }
            GroupBox {
                VStack(alignment: .leading, spacing: 16) {
                    HStack {
                        Picker("Serviço do plano de fundo", selection: $model.source) {
                            ForEach(Source.allCases, id: \.self) { Text($0.title).tag($0) }
                        }
                        Button("Atualizar e aplicar") { model.refreshDaily(force: true) }.buttonStyle(.borderedProminent)
                    }
                    Divider()
                    Toggle("Aplicar em todas as mesas e monitores", isOn: $model.allSpaces)
                    HStack {
                        Text(model.spaceStatus).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        Spacer()
                        Button("Reaplicar nas mesas") { model.applyCurrentToSpaces() }.disabled(model.currentPreview == nil)
                    }
                }.padding(10)
            }.disabled(model.busy)
            Button("Ver histórico de \(model.source.title)") { panel = model.source == .bing ? .bing : .spotlight }.disabled(model.busy)
        }
    }
    private var lockScreen: some View {
        VStack(alignment: .leading, spacing: 20) {
            photo(model.currentPreview)
            GroupBox {
                VStack(alignment: .leading, spacing: 12) {
                    Label("Acompanha o plano de fundo", systemImage: "link").font(.headline)
                    Text("O iWallPeek usa a mesma imagem do plano de fundo na tela de bloqueio, conforme o comportamento do macOS. A escolha de um serviço independente para bloqueio não está disponível nesta versão.")
                    Text("A tela de login após reiniciar pode usar o fundo do próprio macOS.").font(.caption).foregroundStyle(.secondary)
                    Button("Configurar plano de fundo") { panel = .wallpaper }
                }.padding(10).frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
    private func service(_ source: Source) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            if source == .bing {
                GroupBox {
                    HStack {
                        Picker("Região das imagens do Bing", selection: $model.region) {
                            ForEach(WallpaperService.markets, id: \.0) { market in Text(market.1).tag(market.0) }
                        }.onChange(of: model.region) { _ in model.loadCatalog(.bing) }
                    }.padding(10)
                }.disabled(model.busy)
            }
            photo(model.preview)
            if let selected = model.selected { Text(selected.title).font(.headline).textSelection(.enabled) }
            HStack {
                Button { model.move(1) } label: { Label("Anterior", systemImage: "chevron.left") }
                    .disabled(model.selectedID == model.catalog.last?.id)
                Button { model.move(-1) } label: { Label("Próxima", systemImage: "chevron.right") }
                    .disabled(model.selectedID == model.catalog.first?.id)
                Spacer()
                Button("Salvar imagem…") { model.saveSelected() }
                Button("Usar como plano de fundo") { model.applySelected() }.buttonStyle(.borderedProminent)
            }.disabled(model.busy || model.selected == nil)
            GroupBox {
                VStack(alignment: .leading, spacing: 12) {
                    Toggle("Autossalvar imagem diária de \(source.title)", isOn: source == .bing ? $model.autoBing : $model.autoSpotlight)
                    HStack {
                        Image(systemName: "folder")
                        Text(source == .bing ? model.folderBing : model.folderSpotlight).font(.caption).textSelection(.enabled).lineLimit(2)
                        Spacer()
                        Button("Escolher pasta…") { model.chooseFolder(source) }
                        Button("Abrir") { model.openFolder(source) }
                    }
                    Text("As cópias nesta pasta são permanentes. A limpeza do cache interno não remove suas fotos salvas.").font(.caption).foregroundStyle(.secondary)
                    Button("Buscar e autossalvar agora") { model.refreshDaily(force: true, exportOnly: source) }
                        .disabled(!(source == .bing ? model.autoBing : model.autoSpotlight))
                }.padding(10)
            }.disabled(model.busy)
            GroupBox("Histórico") {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text(source == .bing ? "Imagens recentes buscadas no Bing para a região selecionada." : "Imagem atual e histórico local das imagens já obtidas.")
                            .font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Button("Atualizar histórico") { model.loadCatalog(source) }
                    }
                    if model.catalog.isEmpty { Text("Nenhuma imagem disponível. Atualize o histórico.").foregroundStyle(.secondary).padding() }
                    ForEach(model.catalog) { image in
                        Button { model.select(image.id) } label: {
                            HStack(alignment: .top, spacing: 12) {
                                Image(systemName: model.selectedID == image.id ? "checkmark.circle.fill" : "photo")
                                    .foregroundStyle(model.selectedID == image.id ? Color.accentColor : Color.secondary)
                                Text(displayDate(image.date)).monospacedDigit().frame(width: 90, alignment: .leading)
                                Text(image.title).lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
                            }.padding(8).contentShape(Rectangle())
                        }.buttonStyle(.plain)
                        Divider()
                    }
                }.padding(10)
            }.disabled(model.busy)
        }
    }
    private func displayDate(_ raw: String) -> String {
        guard raw.count == 8, raw.allSatisfy(\.isNumber) else { return raw }
        return raw.suffix(2) + "/" + raw.dropFirst(4).prefix(2) + "/" + raw.prefix(4)
    }
    private var general: some View {
        VStack(alignment: .leading, spacing: 20) {
            GroupBox {
                VStack(alignment: .leading, spacing: 16) {
                    Toggle("Iniciar com o macOS", isOn: Binding(get: { model.loginEnabled }, set: toggleLogin))
                    Picker("Manter cache e histórico local por", selection: $model.retention) {
                        ForEach([7,30,90], id: \.self) { Text("\($0) dias").tag($0) }
                    }
                    Text("Cache interno limitado a 500 MB. A imagem em uso é preservada. As pastas de autossalvamento não são limpas pelo aplicativo.")
                        .font(.caption).foregroundStyle(.secondary)
                }.padding(10)
            }
            GroupBox("Sobre") {
                VStack(alignment: .leading, spacing: 10) {
                    Text("iWallPeek 0.2.0").font(.headline)
                    Text("Baseado no DailyWalls (Xiaohan Tian, MIT). Integração de mesas baseada no wallall (treschar, MIT).")
                    Text("Sem conta ou telemetria própria. Idioma/região são enviados aos serviços Microsoft. Os direitos das fotografias pertencem aos respectivos titulares.").font(.caption).foregroundStyle(.secondary)
                }.padding(10).frame(maxWidth: .infinity, alignment: .leading)
            }
        }.disabled(model.busy)
    }
    private func toggleLogin(_ enabled: Bool) {
        do {
            if enabled { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            if SMAppService.mainApp.status == .requiresApproval { SMAppService.openSystemSettingsLoginItems() }
        } catch { model.status = "Início com o macOS: " + error.localizedDescription }
        model.loginEnabled = SMAppService.mainApp.status == .enabled
    }
}
