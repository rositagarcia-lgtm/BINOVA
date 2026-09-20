const RADIO_TIERRA_M = 6371000;
const aRadianes = (grados) => (grados * Math.PI) / 180;

function haversine(a, b) {
  const dLat = aRadianes(b.lat - a.lat);
  const dLng = aRadianes(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(aRadianes(a.lat)) * Math.cos(aRadianes(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.sqrt(h));
}

function matrizHaversine(puntos) {
  return puntos.map((a) => puntos.map((b) => haversine(a, b)));
}

async function matrizMapbox(puntos, perfil) {
  const token = process.env.MAPBOX_TOKEN;
  if (!token || puntos.length < 2) return null;

  const coordenadas = puntos.map((p) => `${p.lng},${p.lat}`).join(';');
  const url = `https://api.mapbox.com/directions-matrix/v1/mapbox/${perfil}/${coordenadas}`
    + `?annotations=distance,duration&access_token=${encodeURIComponent(token)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const datos = await res.json();
    if (datos.code !== 'Ok' || !datos.distances || !datos.durations) return null;
    const n = puntos.length;
    const bienFormada = (m) => Array.isArray(m) && m.length === n
      && m.every((fila) => Array.isArray(fila) && fila.length === n && fila.every((v) => typeof v === 'number'));
    if (!bienFormada(datos.distances) || !bienFormada(datos.durations)) return null;
    return { distancias: datos.distances, duraciones: datos.durations };
  } catch (e) {
    return null;
  }
}

function largoRuta(ruta, costo) {
  let total = 0;
  for (let i = 1; i < ruta.length; i++) total += costo[ruta[i - 1]][ruta[i]];
  return total;
}

function vecinoMasCercano(costo, n) {
  const visitados = new Set([0]);
  const ruta = [0];
  let actual = 0;
  while (ruta.length < n) {
    let mejor = -1;
    let mejorCosto = Infinity;
    for (let j = 1; j < n; j++) {
      if (!visitados.has(j) && costo[actual][j] < mejorCosto) {
        mejor = j;
        mejorCosto = costo[actual][j];
      }
    }
    visitados.add(mejor);
    ruta.push(mejor);
    actual = mejor;
  }
  return ruta;
}

function dosOpt(rutaInicial, costo) {
  let ruta = rutaInicial;
  let largo = largoRuta(ruta, costo);
  let mejorada = true;
  while (mejorada) {
    mejorada = false;
    for (let i = 1; i < ruta.length - 1; i++) {
      for (let k = i + 1; k < ruta.length; k++) {
        const candidata = ruta.slice(0, i).concat(ruta.slice(i, k + 1).reverse(), ruta.slice(k + 1));
        const largoCandidata = largoRuta(candidata, costo);
        if (largoCandidata < largo - 1e-9) {
          ruta = candidata;
          largo = largoCandidata;
          mejorada = true;
        }
      }
    }
  }
  return ruta;
}

async function planificarRuta({ origen, contenedores, perfil }) {
  const puntos = origen ? [origen, ...contenedores] : [...contenedores];
  if (puntos.length === 0 || (origen && contenedores.length === 0)) {
    return { fuente: null, total_distancia_m: 0, total_duracion_s: null, paradas: [] };
  }

  const mapbox = await matrizMapbox(puntos, perfil);
  const distancias = mapbox ? mapbox.distancias : matrizHaversine(puntos);
  const duraciones = mapbox ? mapbox.duraciones : null;
  const costo = duraciones || distancias;

  const ruta = dosOpt(vecinoMasCercano(costo, puntos.length), costo);

  const paradas = [];
  let totalDistancia = 0;
  let totalDuracion = 0;
  for (let i = origen ? 1 : 0; i < ruta.length; i++) {
    const anterior = i === 0 ? null : ruta[i - 1];
    const distancia = anterior === null ? 0 : distancias[anterior][ruta[i]];
    const duracion = duraciones && anterior !== null ? duraciones[anterior][ruta[i]] : null;
    totalDistancia += distancia;
    if (duracion !== null) totalDuracion += duracion;
    paradas.push({
      orden: paradas.length + 1,
      contenedor: puntos[ruta[i]].contenedor,
      distancia_desde_anterior_m: Math.round(distancia),
      duracion_desde_anterior_s: duracion === null ? null : Math.round(duracion),
    });
  }

  return {
    fuente: mapbox ? 'mapbox' : 'haversine',
    total_distancia_m: Math.round(totalDistancia),
    total_duracion_s: duraciones ? Math.round(totalDuracion) : null,
    paradas,
  };
}

module.exports = {
  haversine, matrizHaversine, matrizMapbox, vecinoMasCercano, dosOpt, largoRuta, planificarRuta,
};
