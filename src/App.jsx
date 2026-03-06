import { useEffect, useMemo, useState } from 'react'
import { ShimmerButton } from '@/components/ui/shimmer-button'
import {
  Circle,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Analytics } from '@vercel/analytics/react'

const markerAIcon = L.divIcon({
  className: 'custom-marker-a',
  html: '<div style="height:16px;width:16px;border-radius:9999px;border:2px solid white;background:#1B3A2A;box-shadow:0 2px 6px rgba(0,0,0,0.35)"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

const markerBIcon = L.divIcon({
  className: 'custom-marker-b',
  html: '<div style="height:16px;width:16px;border-radius:9999px;border:2px solid white;background:#D4860A;box-shadow:0 2px 6px rgba(0,0,0,0.35)"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

const midpointIcon = L.divIcon({
  className: 'custom-marker-midpoint',
  html: '<div style="height:20px;width:20px;border-radius:9999px;border:2px solid white;background:#D4860A;box-shadow:0 0 0 3px #F5EFE0,0 3px 8px rgba(0,0,0,0.35)"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
})

const spotIcon = L.divIcon({
  className: 'custom-marker-spot',
  html: '<div style="height:14px;width:14px;border-radius:9999px;border:2px solid white;background:#4A6B4A;box-shadow:0 1px 4px rgba(0,0,0,0.3)"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
})

const defaultCenter = [20, 0]
const defaultRadiusKm = 1.5

// Each filter entry has an optional `types` array specifying which OSM element
// types to query. Defaults to ['node', 'way'] when omitted. Relations are only
// used where they genuinely represent the feature (e.g. park multipolygons).
const preferenceOptions = [
  {
    key: 'restaurants',
    label: 'Restaurants',
    filters: [
      { key: 'amenity', value: 'restaurant', types: ['node', 'way'] },
      { key: 'amenity', value: 'fast_food',  types: ['node', 'way'] },
    ],
  },
  {
    key: 'cafes',
    label: 'Cafes',
    // Cafes are almost exclusively nodes; including way covers the rare café-in-a-building case.
    // Relations are never used for cafes.
    filters: [{ key: 'amenity', value: 'cafe', types: ['node', 'way'] }],
  },
  {
    key: 'libraries',
    label: 'Libraries',
    filters: [{ key: 'amenity', value: 'library', types: ['node', 'way'] }],
  },
  {
    key: 'parking',
    label: 'Parking Lots',
    // Parking lots are often mapped as way polygons (areas), sometimes nodes.
    filters: [{ key: 'amenity', value: 'parking', types: ['node', 'way'] }],
  },
  {
    key: 'hospitals',
    label: 'Hospitals',
    // Hospitals / clinics are commonly mapped as way polygons (buildings).
    filters: [
      { key: 'amenity', value: 'hospital', types: ['node', 'way'] },
      { key: 'amenity', value: 'clinic',   types: ['node', 'way'] },
    ],
  },
  {
    key: 'parks',
    label: 'Parks',
    // Parks are area features — use way+relation (multipolygon parks).
    // `boundary=national_park` intentionally removed: those are continent-scale
    // relation geometries that reliably cause Overpass timeouts.
    filters: [
      { key: 'leisure', value: 'park',               types: ['way', 'relation'] },
      { key: 'landuse', value: 'recreation_ground',  types: ['way'] },
      { key: 'leisure', value: 'nature_reserve',     types: ['way', 'relation'] },
    ],
  },
  {
    key: 'hotels',
    label: 'Hotels',
    filters: [{ key: 'tourism', value: 'hotel', types: ['node', 'way'] }],
  },
  {
    key: 'theatres',
    label: 'Theatres',
    // `building=theatre` removed: it matches any building shell tagged as a theatre
    // type and is extremely expensive to query. `amenity=theatre` is the correct POI tag.
    filters: [{ key: 'amenity', value: 'theatre', types: ['node', 'way'] }],
  },
]

const toRadians = (deg) => (deg * Math.PI) / 180
const toDegrees = (rad) => (rad * 180) / Math.PI

function biasedGreatCirclePoint([lat1, lon1], [lat2, lon2], bias = 0.5) {
  const phi1 = toRadians(lat1)
  const lambda1 = toRadians(lon1)
  const phi2 = toRadians(lat2)
  const lambda2 = toRadians(lon2)

  const x1 = Math.cos(phi1) * Math.cos(lambda1)
  const y1 = Math.cos(phi1) * Math.sin(lambda1)
  const z1 = Math.sin(phi1)

  const x2 = Math.cos(phi2) * Math.cos(lambda2)
  const y2 = Math.cos(phi2) * Math.sin(lambda2)
  const z2 = Math.sin(phi2)

  const x = (1 - bias) * x1 + bias * x2
  const y = (1 - bias) * y1 + bias * y2
  const z = (1 - bias) * z1 + bias * z2

  const norm = Math.sqrt(x * x + y * y + z * z)
  const nx = x / norm
  const ny = y / norm
  const nz = z / norm

  const latitude = toDegrees(Math.atan2(nz, Math.sqrt(nx * nx + ny * ny)))
  const longitude = toDegrees(Math.atan2(ny, nx))

  return [latitude, longitude]
}

function normalizeLongitude(longitude) {
  return ((((longitude + 180) % 360) + 360) % 360) - 180
}

function buildGreatCirclePath(pointA, pointB, segments = 96) {
  if (!pointA || !pointB) {
    return []
  }

  const path = []
  for (let step = 0; step <= segments; step += 1) {
    const t = step / segments
    const [lat, lon] = biasedGreatCirclePoint([pointA.lat, pointA.lon], [pointB.lat, pointB.lon], t)
    path.push([lat, lon])
  }

  for (let index = 1; index < path.length; index += 1) {
    const previousLon = path[index - 1][1]
    let currentLon = normalizeLongitude(path[index][1])

    while (currentLon - previousLon > 180) {
      currentLon -= 360
    }
    while (currentLon - previousLon < -180) {
      currentLon += 360
    }

    path[index] = [path[index][0], currentLon]
  }

  return path
}

function shortenAddress(address = '') {
  return address
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(', ')
}

async function geocodeAddress(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error('Geocoding request failed.')
  }

  const data = await response.json()
  if (!data.length) {
    throw new Error(`No results for "${query}".`)
  }

  return {
    lat: Number.parseFloat(data[0].lat),
    lon: Number.parseFloat(data[0].lon),
    displayName: data[0].display_name,
    shortName: shortenAddress(data[0].display_name),
  }
}

function buildOverpassQuery(latitude, longitude, radiusMeters, filters) {
  const lines = filters
    .flatMap(({ key, value, types = ['node', 'way'] }) =>
      types.map(
        (type) => `\n  ${type}["${key}"="${value}"](around:${radiusMeters},${latitude},${longitude});`,
      ),
    )
    .join('')

  // timeout:14 lets the server self-cancel before the 20s client abort fires.
  // maxsize:16777216 (16 MB) caps runaway response payloads.
  // out center qt uses quadtile ordering which is faster on large result sets.
  return `[out:json][timeout:14][maxsize:16777216];(${lines}\n);out center qt;`
}

function parseOverpassElements(elements) {
  return elements
    .map((element) => {
      const latitude = element.lat ?? element.center?.lat
      const longitude = element.lon ?? element.center?.lon

      if (typeof latitude !== 'number' || typeof longitude !== 'number') {
        return null
      }

      const tags = element.tags ?? {}
      const name = tags.name || tags.brand || 'Unnamed spot'
      const typeTag = tags.amenity || tags.leisure || tags.tourism || tags.landuse || 'place'
      const address = [
        tags['addr:housenumber'],
        tags['addr:street'],
        tags['addr:city'],
        tags['addr:state'],
        tags['addr:postcode'],
      ]
        .filter(Boolean)
        .join(', ')

      return {
        id: `${element.type}-${element.id}`,
        lat: latitude,
        lon: longitude,
        name,
        typeTag,
        address: address || 'Address unavailable',
        googleMapsUrl: `https://www.google.com/maps?q=${latitude},${longitude}`,
      }
    })
    .filter(Boolean)
}

async function searchPlacesInArea(midpoint, radiusKm, selectedKeys) {
  const activePreferences =
    selectedKeys.length > 0
      ? preferenceOptions.filter((option) => selectedKeys.includes(option.key))
      : preferenceOptions

  const filters = []
  activePreferences.forEach((option) => {
    option.filters.forEach((filter) => {
      const filterTypes = filter.types ?? ['node', 'way']
      const exists = filters.some(
        (item) =>
          item.key === filter.key &&
          item.value === filter.value &&
          JSON.stringify(item.types ?? ['node', 'way']) === JSON.stringify(filterTypes),
      )
      if (!exists) {
        filters.push(filter)
      }
    })
  })

  const query = buildOverpassQuery(midpoint.lat, midpoint.lon, Math.round(radiusKm * 1000), filters)
  const body = new URLSearchParams({ data: query }).toString()

  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ]

  for (const endpoint of endpoints) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 20000)

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          Accept: 'application/json',
        },
        body,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        continue
      }

      const data = await response.json()
      return parseOverpassElements(data.elements ?? []).slice(0, 120)
    } catch {
      clearTimeout(timeoutId)
      // try next endpoint
    }
  }

  throw new Error('Area search failed. Please try again.')
}

function FitMapToPoints({ points }) {
  const map = useMap()

  useEffect(() => {
    if (!points.length) {
      return
    }

    const bounds = L.latLngBounds(points.map((point) => [point.lat, point.lon]))
    map.fitBounds(bounds, { padding: [40, 40] })
  }, [map, points])

  return null
}

export default function App() {
  const [addressA, setAddressA] = useState('New York, NY')
  const [addressB, setAddressB] = useState('Los Angeles, CA')
  const [pointA, setPointA] = useState(null)
  const [pointB, setPointB] = useState(null)
  const [bias, setBias] = useState(0.5)
  const [enableAreaSearch, setEnableAreaSearch] = useState(false)
  const [radiusKm, setRadiusKm] = useState(defaultRadiusKm)
  const [selectedPreferences, setSelectedPreferences] = useState([])
  const [searchResults, setSearchResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const midpoint = useMemo(() => {
    if (!pointA || !pointB) {
      return null
    }

    const [lat, lon] = biasedGreatCirclePoint([pointA.lat, pointA.lon], [pointB.lat, pointB.lon], bias)
    return {
      lat,
      lon,
      displayName: `Bias-adjusted midpoint (${bias.toFixed(2)})`,
      googleMapsUrl: `https://www.google.com/maps?q=${lat},${lon}`,
    }
  }, [bias, pointA, pointB])

  const mapPoints = useMemo(
    () => [pointA, pointB, midpoint, ...searchResults].filter(Boolean),
    [pointA, pointB, midpoint, searchResults],
  )

  const routePath = useMemo(() => buildGreatCirclePath(pointA, pointB), [pointA, pointB])

  const handlePreferenceToggle = (key) => {
    setSelectedPreferences((current) =>
      current.includes(key) ? current.filter((value) => value !== key) : [...current, key],
    )
  }

  const handleFindMidpoint = async (event) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    setSearchResults([])

    try {
      const [resultA, resultB] = await Promise.all([
        geocodeAddress(addressA.trim()),
        geocodeAddress(addressB.trim()),
      ])

      setPointA(resultA)
      setPointB(resultB)

      if (enableAreaSearch) {
        const [midLat, midLon] = biasedGreatCirclePoint(
          [resultA.lat, resultA.lon],
          [resultB.lat, resultB.lon],
          bias,
        )

        const results = await searchPlacesInArea(
          { lat: midLat, lon: midLon },
          radiusKm,
          selectedPreferences,
        )

        setSearchResults(results)
      }
    } catch (err) {
      setError(err.message || 'Unable to calculate midpoint.')
      setPointA(null)
      setPointB(null)
      setSearchResults([])
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="h-screen overflow-hidden bg-[#7B9E82]">
      <div className="flex h-full flex-col md:flex-row">
        <section className="w-full border-r border-[#C8D5C0] bg-[#F5EFE0] p-4 shadow-2xl md:w-1/2 md:p-6">
          <div className="panel-scroll mx-auto flex h-full w-full max-w-xl flex-col overflow-y-auto">
            <div className="border-b border-[#C8D5C0] pb-4 mb-4">
              <h1 className="font-display text-3xl font-bold tracking-tight text-[#1B3A2A]">Geographical Midpoint Finder</h1>
              <p className="mt-1.5 text-xs text-[#4A6B4A]">
                Enter two addresses and find what's in between!
              </p>
            </div>

            <form onSubmit={handleFindMidpoint} className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-3">
              <label className="block md:col-span-2">
                <span className="mb-1.5 block text-xs font-semibold text-[#1B3A2A]">Address A</span>
                <input
                  value={addressA}
                  onChange={(event) => setAddressA(event.target.value)}
                  className="w-full rounded-lg border border-[#A8C4A0] bg-white px-3 py-2.5 text-sm text-[#1B3A2A] shadow-sm placeholder:text-[#A8C4A0] focus:border-[#D4860A] focus:outline-none focus:ring-2 focus:ring-[#D4860A]/30"
                  placeholder="e.g., New York, NY"
                  required
                />
              </label>

              <label className="block md:col-span-2">
                <span className="mb-1.5 block text-xs font-semibold text-[#1B3A2A]">Address B</span>
                <input
                  value={addressB}
                  onChange={(event) => setAddressB(event.target.value)}
                  className="w-full rounded-lg border border-[#A8C4A0] bg-white px-3 py-2.5 text-sm text-[#1B3A2A] shadow-sm placeholder:text-[#A8C4A0] focus:border-[#D4860A] focus:outline-none focus:ring-2 focus:ring-[#D4860A]/30"
                  placeholder="e.g., Los Angeles, CA"
                  required
                />
              </label>

              <label className="block md:col-span-2">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#1B3A2A]">Bias slider</span>
                  <span className="rounded-full bg-[#1B3A2A] px-2.5 py-0.5 text-[11px] font-semibold text-[#F5EFE0]">
                    {bias.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={bias}
                  onChange={(event) => setBias(Number(event.target.value))}
                  className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-[#C8D5C0] accent-[#D4860A]"
                />
                <div className="mt-1.5 flex justify-between text-[10px] font-semibold uppercase tracking-wide text-[#4A6B4A]">
                  <span>Closer to A</span>
                  <span>Even</span>
                  <span>Closer to B</span>
                </div>
              </label>

              <label className="flex cursor-pointer items-center justify-between rounded-lg border border-[#A8C4A0] bg-white px-3 py-2.5 shadow-sm md:col-span-2">
                <span className="text-xs font-semibold text-[#1B3A2A]">Search the area for a specific spot?</span>
                <input
                  type="checkbox"
                  checked={enableAreaSearch}
                  onChange={(event) => setEnableAreaSearch(event.target.checked)}
                  className="h-4 w-4 accent-[#D4860A]"
                />
              </label>

              {enableAreaSearch && (
                <div className="space-y-3 rounded-lg border border-[#A8C4A0] bg-[#E8EDDF] p-3 md:col-span-2">
                  <div className="grid grid-cols-2 items-end gap-2">
                    <label className="block col-span-2">
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-xs font-semibold text-[#1B3A2A]">Circle radius</span>
                        <div className="flex items-center gap-1 rounded-full bg-[#FDF0D5] px-2.5 py-0.5 text-[11px] font-semibold text-[#7A4F00]">
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            value={radiusKm}
                            onChange={(event) => setRadiusKm(Number(event.target.value) || 0)}
                            className="w-14 bg-transparent text-right focus:outline-none"
                            aria-label="Radius in kilometers"
                          />
                          <span>km</span>
                        </div>
                      </div>
                      <input
                        type="range"
                        min="0.3"
                        max="10"
                        step="0.1"
                        value={Math.min(10, Math.max(0.3, radiusKm))}
                        onChange={(event) => setRadiusKm(Number(event.target.value))}
                        className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-[#C8D5C0] accent-[#D4860A]"
                      />
                    </label>
                  </div>

                  <div>
                    <p className="mb-1.5 text-xs font-semibold text-[#1B3A2A]">Filters</p>
                    <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3">
                      {preferenceOptions.map((option) => (
                        <label
                          key={option.key}
                          className="flex cursor-pointer items-center gap-2 rounded-md border border-[#A8C4A0] bg-white/60 px-2 py-1.5 text-xs text-[#1B3A2A] transition hover:bg-white/90"
                        >
                          <input
                            type="checkbox"
                            checked={selectedPreferences.includes(option.key)}
                            onChange={() => handlePreferenceToggle(option.key)}
                            className="h-3.5 w-3.5 accent-[#D4860A]"
                          />
                          {option.label}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <ShimmerButton
                type="submit"
                disabled={loading}
                shimmerColor="#ffffff"
                shimmerDuration="2.5s"
                borderRadius="8px"
                background={loading ? 'rgba(184, 160, 138, 1)' : 'rgba(212, 134, 10, 1)'}
                className="w-full py-2.5 text-sm font-semibold shadow-md disabled:cursor-not-allowed md:col-span-2"
              >
                {loading ? 'Searching…' : 'Find Midpoint'}
              </ShimmerButton>
            </form>

            <div className="mt-4 rounded-xl border border-[#A8C4A0] bg-white/70 p-3 text-xs shadow-sm">
              {error ? (
                <p className="font-medium text-[#C0392B]">{error}</p>
              ) : pointA && pointB ? (
                <ul className="space-y-1 text-[#1B3A2A]">
                  <li>
                    <strong>Address 1:</strong> {pointA.shortName}
                  </li>
                  <li>
                    <strong>Address 2:</strong> {pointB.shortName}
                  </li>
                  {enableAreaSearch && (
                    <li>
                      <strong>Found spots:</strong> {searchResults.length}
                    </li>
                  )}
                </ul>
              ) : (
                <p className="text-[#4A6B4A]">Results will appear here after calculation.</p>
              )}
            </div>
          </div>
        </section>

        <section className="h-[45vh] w-full md:h-full md:w-1/2">
          <MapContainer center={defaultCenter} zoom={2} scrollWheelZoom className="h-full w-full">
            <TileLayer
              attribution='&copy; OpenStreetMap contributors &copy; CARTO'
              url="https://{s}.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png"
            />

            {mapPoints.length > 0 && <FitMapToPoints points={mapPoints} />}

            {routePath.length > 1 && (
              <Polyline
                positions={routePath}
                pathOptions={{ color: '#1B3A2A', weight: 5, dashArray: '14 10', lineCap: 'round', opacity: 0.85 }}
              />
            )}

            {enableAreaSearch && midpoint && (
              <Circle
                center={[midpoint.lat, midpoint.lon]}
                radius={Math.max(0, radiusKm) * 1000}
                pathOptions={{ color: '#1B3A2A', weight: 1.5, fillColor: '#D4860A', fillOpacity: 0.13 }}
              />
            )}

            {pointA && (
              <Marker position={[pointA.lat, pointA.lon]} icon={markerAIcon}>
                <Popup>Address A: {pointA.displayName}</Popup>
              </Marker>
            )}

            {pointB && (
              <Marker position={[pointB.lat, pointB.lon]} icon={markerBIcon}>
                <Popup>Address B: {pointB.displayName}</Popup>
              </Marker>
            )}

            {midpoint && (
              <Marker position={[midpoint.lat, midpoint.lon]} icon={midpointIcon}>
                <Popup>
                  <div className="space-y-1">
                    <p className="font-semibold">Adjusted midpoint ({bias.toFixed(2)})</p>
                    <p className="text-xs">
                      {midpoint.lat.toFixed(6)}, {midpoint.lon.toFixed(6)}
                    </p>
                    <a
                      href={midpoint.googleMapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-semibold text-[#D4860A] underline"
                    >
                      Open midpoint in Google Maps
                    </a>
                  </div>
                </Popup>
              </Marker>
            )}

            {searchResults.map((spot) => (
              <Marker key={spot.id} position={[spot.lat, spot.lon]} icon={spotIcon}>
                <Popup>
                  <div className="space-y-1">
                    <p className="font-semibold">{spot.name}</p>
                    <p className="text-xs capitalize text-slate-700">{spot.typeTag.replace('_', ' ')}</p>
                    <p className="text-xs">{spot.address}</p>
                    <a
                      href={spot.googleMapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-semibold text-[#D4860A] underline"
                    >
                      Open in Google Maps
                    </a>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </section>
      </div>
      <Analytics />
    </main>
  )
}
