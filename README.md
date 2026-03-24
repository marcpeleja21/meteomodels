# 🌍 MeteoModels

**Comparativa de models meteorològics en temps real**

Aplicació web que permet consultar i comparar les previsions del temps de fins a **8 models meteorològics** simultàniament per a qualsevol localitat del món.

---

## ✨ Funcionalitats

- 🔍 **Cerca geocodificada** de qualsevol localitat
- ⚖️ **Mitjana de models (ensemble)** — temperatura, sensació tèrmica, prob. pluja, vent, humitat, pressió i qualitat de l'aire (AQI europeu)
- 📅 **Previsió de 5 dies** basada en la mitjana de tots els models disponibles
- 🃏 **Targetes individuals** per cada model carregat (temperatura, humitat, pluja)
- 🔘 **Selector de model** — filtra la previsió per un model concret
- 📈 **Gràfic comparatiu** amb 6 mètriques seleccionables: temp. màx/mín, probabilitat de pluja, vent, humitat i pressió atmosfèrica
- 📊 **Taula de 7 dies** comparant tots els models fila a fila
- 🌧️ **Animacions de fons** adaptades al temps (pluja, neu)
- 🌐 **4 idiomes**: Català, Espanyol, Anglès i Francès
- 📍 **Altitud** de cada localitat mostrada a la capçalera

---

## 🛰️ Models meteorològics

| Model | Organisme | Cobertura | Resolució |
|-------|-----------|-----------|-----------|
| **GFS** | NOAA (EUA) | Global | ~13 km |
| **ECMWF IFS** | ECMWF (Europa) | Global | 0.25° |
| **ICON** | DWD (Alemanya) | Global | ~13 km |
| **ICON EU** | DWD (Alemanya) | Europa | 7 km |
| **MeteoBlue NMM** | MeteoBlue (Suïssa) | Global | * API key |
| **AROME HD** | Météo-France | França/entorns | 1.5 km |
| **AROME 2.5km** | Météo-France | França/entorns | 2.5 km |
| **ARPEGE EU** | Météo-France | Europa | ~5 km (proxy ALADIN) |

> \* MeteoBlue requereix una API key pròpia de [meteoblue.com](https://www.meteoblue.com/en/weather-api)

---

## 🚀 Ús

L'aplicació és un **fitxer HTML únic** sense dependències externes ni procés de compilació.

### Opció 1 — Obrir directament
```bash
open index.html
```

### Opció 2 — Servidor local (recomanat)
```bash
npx serve -p 4321 .
# Obre http://localhost:4321
```

### Opció 3 — GitHub Pages / Netlify / Vercel
Puja el repositori i activa les GitHub Pages apuntant a `index.html`. No cal cap configuració addicional.

---

## 📡 APIs utilitzades

| API | Ús | Preu |
|-----|----|------|
| [Open-Meteo Forecast](https://open-meteo.com) | Dades meteorològiques (tots els models) | Gratuït |
| [Open-Meteo Geocoding](https://open-meteo.com/en/docs/geocoding-api) | Cerca de localitats | Gratuït |
| [Open-Meteo Air Quality](https://open-meteo.com/en/docs/air-quality-api) | Índex de qualitat de l'aire (AQI europeu) | Gratuït |
| [MeteoBlue API](https://www.meteoblue.com/en/weather-api) | Model MeteoBlue NMM | API key pròpia |

---

## 🏗️ Tecnologies

- **HTML5 + CSS3 + JavaScript** pur (sense frameworks ni dependències)
- **Canvas API** per a les animacions de fons (pluja, neu)
- **SVG** per al gràfic comparatiu
- **LocalStorage** per guardar l'idioma i la clau de MeteoBlue
- Disseny inspirat en [Windy](https://windy.com) — tema fosc, professional

---

## 📸 Captura de pantalla

> Cerca una localitat i compara les previsions de fins a 8 models meteorològics simultàniament.

---

## 📄 Llicència

MIT — Lliure ús, modificació i distribució.
