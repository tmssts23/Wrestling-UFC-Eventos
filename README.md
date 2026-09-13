# Addon Stremio / Nuvio — Wrestling & UFC (Eventos)

Addon de **catálogos e metadados** para Stremio e Nuvio com os eventos das principais
promoções de wrestling (WWE, AEW, TNA) e os eventos da UFC.
**Toda a informação vem do [TMDB](https://www.themoviedb.org/), em pt-PT sempre que existe tradução.**

## Chave do TMDB: cada pessoa usa a sua

Quem instala o addon indica a **própria chave do TMDB** na página de configuração
(`/configure`). A chave é validada no momento e fica guardada dentro do link de
instalação, por isso cada utilizador gasta a sua quota e não a do servidor.

Para obter uma chave:

1. Cria conta em <https://www.themoviedb.org/> e vai a *Definições → API*.
2. Pede uma chave (uso pessoal é aprovado na hora) e copia a **API Key (v3)**.
   Também serve o *token de leitura (v4)*.

> A chave viaja no link do manifest. Não partilhes esse link publicamente — quem o
> tiver usa a tua chave. Se precisares, gera uma nova no TMDB e reinstala.

Sem chave, o Stremio pede para configurar antes de instalar. Os catálogos ainda mostram
os dados guardados em `data/`, mas as fichas com temporadas e episódios precisam da chave.

Opcional para quem aloja: definir `TMDB_API_KEY` (ou `TMDB_ACCESS_TOKEN`) no servidor faz
dessa chave a predefinição para instalações sem chave própria, e é também a usada por
`npm run refresh-data`.

## Como o TMDB organiza estes eventos

No TMDB os programas semanais são séries, mas **cada PPV é um filme individual**
("WWE Royal Rumble 2025", "AEW All Out 2024", "UFC 300: Pereira vs. Hill"). Por isso os
catálogos de cada promoção juntam três coisas:

| Item | Tipo | O que é |
|---|---|---|
| Programas | série | Raw, SmackDown, NXT, Dynamite, Impact… com temporadas e episódios |
| Coleções por ano | série | Evento recorrente agrupado pelo addon: *WWE WrestleMania*, *AEW All Out*, *TNA Slammiversary*… temporada = ano, episódio = edição desse ano |
| Eventos individuais | filme | Cada PPV como item próprio, com o seu póster, sinopse e data |

As coleções por ano são construídas a partir dos filmes do TMDB (ver `lib/franchises.js`);
um evento só vira coleção a partir de duas edições — abaixo disso fica como evento individual.

## Separador «Fight» no Explorar

O addon declara cada catálogo duas vezes:

- **Ecrã principal:** os catálogos de sempre, com os nomes completos (*WWE — Eventos e
  Programas*, *UFC — Eventos Numerados*…), em Filmes e Séries.
- **Explorar → Fight:** uma cópia com nomes curtos (*WWE*, *WWE · Últimos 7 dias*, *AEW*,
  *TNA*, *UFC*, *UFC · Fight Night*). Estes levam o filtro de género obrigatório, com
  «Todos» por omissão — é isso que faz o Stremio não os repetir no ecrã principal.

Os itens continuam a ser filmes e séries, por isso as fichas e os addons de streams funcionam
como antes. Como os catálogos do ecrã principal são de Filmes e Séries, também aparecem nesses
separadores do Explorar.

O tipo «Fight» não faz parte dos quatro tipos documentados pelo Stremio (movie, series,
channel, tv). As apps Stremio mostram na prática os tipos declarados pelos addons, mas se
alguma app (ex.: Nuvio) não mostrar o separador, escolhe **«Dentro de Filmes e Séries»** na
página de configuração e reinstala.

## Catálogos

| Token | Catálogo | Tipo | Conteúdo |
|---|---|---|---|
| `wwe` | WWE — Eventos e Programas | series | Programas + coleções por ano + eventos individuais (inclui arquivo WWF/WCW/ECW) |
| `wwe7` | WWE — Últimos 7 Dias | series | Episódios emitidos **e** eventos lançados na última semana |
| `aew` | AEW — Eventos e Programas | series | Idem, para a All Elite Wrestling |
| `aew7` | AEW — Últimos 7 Dias | series | Idem |
| `tna` | TNA — Eventos e Programas | series | Idem, para a TNA / Impact Wrestling |
| `tna7` | TNA — Últimos 7 Dias | series | Idem |
| `ufc` | UFC — Eventos Numerados | movie | Só eventos numerados (*UFC 330: Makhachev vs. Machado Garry*), do mais recente para o mais antigo (agendados no fim). São os que costumam ter streams: ~91% têm IMDb |
| `ufcfn` | UFC — Fight Night e Outros Eventos | movie | UFC Fight Night, UFC on ESPN/ABC e afins. Poucos têm IMDb (~26%), por isso raramente têm streams (desligado por predefinição) |
| `ufcshows` | UFC — Programas e Documentários | series | The Ultimate Fighter, Embedded, documentários (desligado por predefinição) |

Filtros:

- **Pesquisa** (`search`) em todos os catálogos.
- **Género** nos catálogos de promoções: `Eventos PPV / PLE`, `Programas semanais`,
  `Coleções por ano`, `Eventos individuais`, `Em exibição`, `Arquivo`.
- **Género** no catálogo UFC numerados: `Agendados`. No de Fight Night: `Fight Night`,
  `UFC on ESPN / ABC / Fox`, `The Ultimate Fighter`, `Agendados`.
- A recolha procura um a um os números UFC que a pesquisa genérica não apanha ("UFC 325") e
  deixa uma só ficha por número quando o TMDB tem duplicados.

## Instalar

1. Abre `http://127.0.0.1:7100/configure` (ou o endereço onde o alojares). A página tem um
   seletor **PT / EN** no canto superior; a escolha fica guardada no browser e, na primeira
   visita, segue o idioma do browser.
2. Cola a tua chave do TMDB (é validada na hora) e escolhe os catálogos.
3. **Stremio**: clica em *Instalar no Stremio*.
   **Nuvio**: copia o link do manifest e cola em *Settings → Addons → Add addon*.

A página gera um link com a configuração codificada (catálogos + chave):

```
https://o-teu-dominio/eyJjIjpbIndXZSIs.../manifest.json
```

Para quem aloja com `TMDB_API_KEY` no servidor, continua a funcionar o formato simples,
só com catálogos:

```
https://o-teu-dominio/wwe,wwe7,ufc/manifest.json     # WWE + últimos 7 dias + UFC
https://o-teu-dominio/all/manifest.json              # todos
```

## Como correr

```bash
npm install
npm run dev                          # http://127.0.0.1:7100 -> /configure para pôr a chave
```

Produção (bundle único):

```bash
npm run build
npm start
```

Endpoints: `/manifest.json`, `/catalog/{tipo}/{id}.json`, `/meta/{tipo}/{id}.json`,
`/configure`, `/art/poster.svg` (póster gerado quando não há imagem) e `/health`.

## Fonte de dados

Catálogos, eventos, pósteres e descrições vêm do TMDB: `/search/movie`, `/search/tv`,
`/movie/{id}`, `/tv/{id}` e `/tv/{id}/season/{n}`. As imagens são servidas diretamente por
`image.tmdb.org`.

### Episódios dos programas semanais

Os episódios (Raw, SmackDown, NXT, Dynamite, Impact…) vêm de:

1. **TMDB** (com chave) — títulos, imagens, datas e sinopses em pt-PT. Os ids que seguem
   para os addons de streams usam a numeração do IMDb, tirada do **Cinemeta** (addon oficial
   do Stremio): cada episódio do TMDB recebe o número IMDb do episódio emitido no mesmo dia
   (±1 dia). O TMDB numera alguns programas de outra forma (ex.: NXT com 4 episódios de
   diferença), o que mandava o addon de streams para o episódio errado.
2. **Cinemeta** (sem chave) — quando a instalação não tem chave. As datas do Cinemeta podem
   ficar 1 dia à frente (as horas que guarda não são coerentes entre programas); a pesquisa de
   vídeos no YouTube aceita essa diferença.
3. **TVmaze** (sem chave) — programas sem IMDb, ligados à mão em `tvmazeFallback`
   (`lib/promotions.js`). De momento não há nenhum ligado.

Por isso as fichas dos programas e o catálogo dos últimos 7 dias funcionam **mesmo sem chave**.
A chave traz as datas exatas, as sinopses em pt-PT, a lista "Onde ver em PT" e os episódios
mais recentes que o Cinemeta ainda não tem (ex.: AEW Collision, com semanas de atraso).

Nos vídeos do YouTube de episódios de programas semanais (com ou sem título próprio), o vídeo
tem de trazer a data de emissão (dia e mês) ou as palavras do título do episódio, e é sempre
rejeitado se mencionar outro ano, se tiver sido carregado antes da emissão, ou se for de um
programa com nome parecido (*WWE Main Event* vs. *Saturday Night's Main Event*). Isto afasta
vídeos antigos do mesmo programa ("Full SmackDown highlights: Aug. 14") que antes passavam só
por terem o nome do programa.

### Últimos 7 dias

Conta por dias de calendário: hoje e os 7 dias anteriores inteiros (antes eram 7×24 h a partir
da hora do pedido, o que deixava de fora eventos do primeiro dia). Junta o último episódio
emitido de cada programa em exibição e os eventos individuais lançados nesse período.

Cada episódio deste catálogo tem ficha própria (`wwrs-ep-programa-temporada-episódio`) só com
esse episódio e `behaviorHints.defaultVideoId`, por isso abre diretamente nos streams dessa
data, em vez da lista de temporadas do programa. Nos outros catálogos o programa abre como
sempre, com todas as temporadas.

### Top 10

No separador **Fight** há um *Top 10* por promoção (WWE, AEW, TNA e UFC — só numerados).
Escolhe os eventos **mais votados no TMDB entre os realizados nos últimos 12 meses** (alarga a
24 meses, e depois a todos, se houver menos de 10). Ter IMDb vale um bónus, porque são os que os
addons de streams encontram; avaliação e popularidade só desempatam (a popularidade do TMDB para
estes eventos varia entre 1 e 7 e sozinha dava resultados sem sentido). Não aparece no ecrã
principal.

Eventos com data anterior à fundação da promoção (WWE 1963, AEW 2019, TNA 2002, UFC 1993)
são descartados: são filmes sem relação que passavam no filtro pelo nome (ex.: *"Backlash"*,
1947).
As sinopses são pedidas em pt-PT e, quando o TMDB ainda não tem tradução, o addon
recorre ao texto em inglês em vez de deixar a descrição vazia.

Variáveis de ambiente:

```
TMDB_API_KEY=...           # opcional: chave predefinida do servidor (ou TMDB_ACCESS_TOKEN)
TMDB_LANGUAGE=pt-PT        # idioma das sinopses
PORT=7100                  # porta do servidor
ADDON_DEBUG=1              # mostra falhas de rede na consola
```

## Dados incluídos no repositório

A pasta `data/` guarda o resultado da última recolha, para os catálogos responderem de
imediato em arranques a frio (importante na Vercel):

- `data/shows.json` — programas e eventos de cada promoção
- `data/ufc-events.json` — eventos UFC
- `data/meta.json` — data da última recolha

A recolha completa são milhares de pedidos ao TMDB. Por isso, em execução, o addon só a
refaz em segundo plano quando os dados guardados têm mais de 24 h, uma de cada vez, e
**nunca na Vercel** (cada arranque a frio repetia-a e gastava a quota da chave de quem
instala). Na Vercel, corre `npm run refresh-data` de tempos a tempos e volta a publicar.
Para desligar noutro alojamento: `ADDON_NO_REFRESH=1`.

Em execução o addon atualiza-se sozinho em segundo plano; temporadas e episódios são
pedidos ao TMDB na altura (com cache). Para refrescar os ficheiros:

```bash
npm run refresh-data                  # promoções + eventos UFC
node scripts/refresh-data.js --shows  # só as promoções
node scripts/refresh-data.js --ufc    # só os eventos UFC
```

## Alojamento na Vercel

```bash
npm i -g vercel
vercel
```

O `vercel.json` usa o formato atual da Vercel: a função é detetada em `api/index.js` e um
`rewrites` encaminha todos os pedidos para ela. **Não uses `builds`/`routes`** (formato antigo):
com ele a Vercel avisa *"Build output contains no functions, static or services directory"* e
publica um deploy vazio, que responde 404 a tudo (e o validador de manifests falha com
"custom · root"). O script `vercel-build` não faz nada de propósito — a Vercel não precisa do
bundle de `npm run build`. Os dados (`data/`), a página de configuração e o logótipo entram no
deploy automaticamente, porque são lidos com caminhos que o empacotador da Vercel reconhece.
Não é preciso nenhuma variável: cada instalação traz a sua chave. Se quiseres uma chave
predefinida, define `TMDB_API_KEY` nas variáveis de ambiente do projeto.

## Notas

- **Streams — duas vias:**
  1. **Addons de streams que tenhas instalados.** O Stremio só lhes envia o id, nunca o
     título, e eles só conhecem ids do IMDb. Por isso os eventos com IMDb aparecem nos
     catálogos com o próprio id `tt…`, e os episódios de programas com IMDb usam
     `tt…:temporada:episódio`. A recolha (`npm run refresh-data`) vai buscar o IMDb de cada
     evento ao TMDB. Cobertura atual: WWE 792/976, AEW 66/86, TNA 195/299,
     UFC 352/725.
  2. **Vídeos do YouTube, reproduzidos no leitor da app.** O addon pesquisa no YouTube pelo
     título do evento (com o ano) ou, nos episódios sem título próprio, pelo programa e pela
     data de emissão. Depois escolhe até 8 vídeos que correspondem mesmo ao pedido:
     - rejeita vídeos de outro evento ("UFC 313" quando pediste "UFC 300"), de outro ano ou,
       num combate "A vs B", que não tenham os dois nomes;
     - baixa a prioridade de reações, antevisões, reviews, pré-shows e shorts;
     - põe primeiro os canais oficiais verificados (✔).
     Cada vídeo aparece como stream `ytId`, que o Stremio reproduz no leitor interno. A
     pesquisa não usa chave: lê a página pública de resultados. Se o YouTube mudar o formato
     ou demorar mais de 7 s, a lista segue sem vídeos e ficam as outras opções.
  3. **Pesquisa pelo título, feita por este addon.** Em cada evento e episódio aparecem
     opções que abrem a pesquisa pelo nome (ou pelo nome do programa + data de emissão)
     em fontes oficiais: YouTube, Netflix (WWE), Triller TV, AEW+, TNA+,
     UFC Fight Pass, e "Onde ver em PT" com a lista do TMDB/JustWatch quando existe.
     É a única via para os eventos sem IMDb (ex.: metade dos eventos TNA).
- Para os addons de streams, abre o **evento individual** (ex.: *UFC 300*). Dentro das
  coleções por ano a ficha é uma série, e esses addons costumam não responder a um filme
  pedido como episódio; a pesquisa pelo título funciona nos dois sítios.
- Nas coleções por ano, a temporada é o **ano** da edição (ex.: temporada 2024,
  episódio 1 = *WrestleMania XL Saturday*).
- Pré-shows e programas satélite (*Zero Hour*, *Kickoff*, *Prelims*, *Countdown*…) são
  filtrados, para os catálogos mostrarem só os eventos.
- As avaliações mostradas são as do TMDB.
- Eventos por realizar aparecem no fim do catálogo UFC e com `(agendado)` na descrição.

## Estrutura

```
index.js                 servidor HTTP, manifest, catálogos e meta
lib/catalogs.js          definição dos catálogos e leitura da configuração do URL
lib/promotions.js        promoções, pesquisas ao TMDB e filtros por título
lib/tmdb.js              cliente da API do TMDB
lib/franchises.js        agrupamento dos PPVs em coleções por ano
lib/store.js             junta dados do repositório com atualização em segundo plano
lib/meta.js              construção dos objetos de metadados do Stremio
lib/cache.js             cache em memória com revalidação
lib/httpx.js             pedidos HTTP com retentativas e limite de concorrência
scripts/refresh-data.js  atualiza os ficheiros de data/
public/configure.html    página de configuração
```
