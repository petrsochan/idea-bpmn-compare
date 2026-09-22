# BPMN Compare – IntelliJ IDEA plugin

Vizuální porovnání BPMN diagramů s libovolnou Git revizí pomocí [bpmn.io](https://bpmn.io)
(`bpmn-js` pro vykreslení, `bpmn-js-differ` pro výpočet rozdílů).

- **Vlevo** aktuální obsah souboru (včetně neuložených změn, obnovuje se při editaci).
- **Vpravo** stejný soubor z vybrané větve (lokální/remote), tagu, commitu, který soubor měnil, nebo libovolné revize (`HEAD~3`, hash…).
- Zvýraznění: 🟢 přidané (vlevo), 🔴 odebrané (vpravo), 🟠 změněné atributy, 🟣 přesunuté (změna layoutu).
  Štítky Added / Removed / Changed / Moved v horní liště fungují jako filtr – kliknutím se daný typ změn skryje
  z diagramů i ze seznamu změn (počty zůstávají vidět, volba se pamatuje).
  Odznak u elementu má tooltip s detaily, tlačítko *Changes list* zobrazí seznam změn – kliknutím se na element vycentruje.
- **Synchronize mouse & view** – zrcadlí kurzor (modrý „ghost“ kurzor ve druhém diagramu), hover a pan/zoom. Nastavení se pamatuje.

## Použití
Otevři `.bpmn` soubor a přepni se na záložku **BPMN Diff** v dolní části editoru,
nebo pravým tlačítkem na soubor → **Compare BPMN with Branch or Commit…**.

## Build
Vyžaduje JDK 21+ a Node.js (npm) – webová část v `webview/` se bundluje esbuildem automaticky při buildu.

```
./gradlew runIde        # sandbox IDE s pluginem
./gradlew buildPlugin   # build/distributions/idea-bpmn-compare-*.zip → Settings | Plugins | Install from Disk
```

Standardně se stáhne IntelliJ IDEA `platformVersion` z `gradle.properties`. Pro build proti lokálně
nainstalované IDEA (bez stahování) nastav cestu v `~/.gradle/gradle.properties`:

```
localIdePath=C:/Program Files/JetBrains/IntelliJ IDEA 2026.2
```

Cíl: IntelliJ IDEA 2026.2+ (build 262) – v této verzi jsou JCEF a DVCS samostatné moduly platformy.

## Struktura
- `src/main/java/com/github/bpmncompare/` – editor tab (`BpmnCompareEditorProvider`), UI + JCEF bridge (`BpmnComparePanel`), Git (`GitRevisions`)
- `webview/src/` – stránka s dvěma `NavigatedViewer`y, diff, markery, synchronizace

## Licence
Plugin je licencován pod [MIT licencí](LICENSE). Soubor `LICENSE` je v kořeni ZIPu pluginu i v `META-INF` jaru.

## Licence třetích stran
Webová část přibaluje [bpmn-js](https://github.com/bpmn-io/bpmn-js) (© Camunda Services GmbH, licence bpmn.io),
[bpmn-js-differ](https://github.com/bpmn-io/bpmn-js-differ) (MIT) a jejich závislosti (MIT / ISC).

- Build (`webview/build.mjs`) generuje `THIRD-PARTY-NOTICES.txt` s copyrightem a plným textem licence
  každého balíčku, který se skutečně dostal do bundlu. Soubor je v kořeni ZIPu pluginu, v jaru vedle bundlu
  a v hlavičce `bundle.js`/`bundle.css` je na něj odkaz. Balíček bez licenčního souboru build zastaví.
- Licence bpmn.io vyžaduje, aby watermark „bpmn.io“ v diagramu zůstal **nezměněný a plně viditelný**
  a nic ho nepřekrývalo – `.bjs-powered-by` proto nesmí být stylováno ani skrýváno.
  Odkazy z watermarku se otevírají v systémovém prohlížeči.
