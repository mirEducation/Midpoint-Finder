import { useEffect, useMemo, useState } from 'react'
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

const markerAIcon = L.divIcon({
  className: 'custom-marker-a',
  html: '<div class="h-4 w-4 rounded-full border-2 border-white bg-emerald-500 shadow-md"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

const markerBIcon = L.divIcon({
  className: 'custom-marker-b',
  html: '<div class="h-4 w-4 rounded-full border-2 border-white bg-green-700 shadow-md"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

const midpointIcon = L.divIcon({
  className: 'custom-marker-midpoint',
  html: '<div class="h-5 w-5 rounded-full border-2 border-white bg-lime-500 shadow-lg ring-2 ring-lime-200"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
})

const spotIcon = L.divIcon({
  className: 'custom-marker-spot',
  html: '<div class="h-3.5 w-3.5 rounded-full border-2 border-white bg-sky-500 shadow"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
})

const defaultCenter = [20, 0]
const defaultRadiusKm = 8

const preferenceOptions = [
  { key: 'restaurants', label: 'Restaurants', tags: ['restaurant', 'fast_food', 'cafe'] },
  { key: 'libraries', label: 'Libraries', tags: ['library'] },
  { key: 'parking', label: 'Parking Lots', tags: ['parking'] },
  { key: 'hospitals', label: 'Hospitals', tags: ['hospital', 'clinic'] },
  { key: 'parks', label: 'Parks', tags: ['park'] },
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
  }
}

function buildOverpassQuery(latitude, longitude, radiusMeters, amenityTags) {
  const amenitiesRegex = amenityTags.join('|')

  return `
[out:json][timeout:30];
(
  node["amenity"~"^(${amenitiesRegex})$"](around:${radiusMeters},${latitude},${longitude});
  way["amenity"~"^(${amenitiesRegex})$"](around:${radiusMeters},${latitude},${longitude});
  relation["amenity"~"^(${amenitiesRegex})$"](around:${radiusMeters},${latitude},${longitude});
);
out center;
`
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
      const amenity = tags.amenity || 'place'
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
        amenity,
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

  const amenityTags = [...new Set(activePreferences.flatMap((option) => option.tags))]
  const query = buildOverpassQuery(midpoint.lat, midpoint.lon, Math.round(radiusKm * 1000), amenityTags)

  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      Accept: 'application/json',
    },
    body: query,
  })

  if (!response.ok) {
    throw new Error('Area search failed. Please try again.')
  }

  const data = await response.json()
  return parseOverpassElements(data.elements ?? []).slice(0, 50)
}

function FitMapToPoints({ points }) {
  const map = useMap()

  useEffect(() => {
    if (!points.length) {
      return
    }

    const bounds = L.latLngBounds(points.map((point) => [point.lat, point.lon]))
    map.fitBounds(bounds, { padding: [50, 50] })
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
    }
  }, [bias, pointA, pointB])

  const mapPoints = useMemo(
    () => [pointA, pointB, midpoint, ...searchResults].filter(Boolean),
    [pointA, pointB, midpoint, searchResults],
  )

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
    <main className="min-h-screen bg-emerald-950 text-emerald-50">
      <div className="flex min-h-screen flex-col md:flex-row">
        <section className="w-full bg-emerald-900/95 p-6 shadow-2xl md:w-1/2 md:p-10">
          <div className="mx-auto flex h-full w-full max-w-xl flex-col">
            <h1 className="text-3xl font-bold tracking-tight text-emerald-100">Geographical Midpoint Finder</h1>
            <p className="mt-3 text-sm text-emerald-200/90">
              Enter two addresses to geocode with Nominatim and place an adjustable midpoint along the route.
            </p>

            <form onSubmit={handleFindMidpoint} className="mt-8 space-y-5">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-emerald-100">Address A</span>
                <input
                  value={addressA}
                  onChange={(event) => setAddressA(event.target.value)}
                  className="w-full rounded-lg border border-emerald-700 bg-emerald-950/80 px-4 py-3 text-emerald-50 placeholder:text-emerald-300/60 focus:border-lime-400 focus:outline-none focus:ring-2 focus:ring-lime-500/40"
                  placeholder="e.g., New York, NY"
                  required
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-emerald-100">Address B</span>
                <input
                  value={addressB}
                  onChange={(event) => setAddressB(event.target.value)}
                  className="w-full rounded-lg border border-emerald-700 bg-emerald-950/80 px-4 py-3 text-emerald-50 placeholder:text-emerald-300/60 focus:border-lime-400 focus:outline-none focus:ring-2 focus:ring-lime-500/40"
                  placeholder="e.g., Los Angeles, CA"
                  required
                />
              </label>

              <label className="block">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-emerald-100">Bias slider</span>
                  <span className="rounded bg-emerald-800/80 px-2 py-1 text-xs font-semibold text-lime-200">
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
                  className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-emerald-700 accent-lime-400"
                />
                <p className="mt-2 text-xs text-emerald-300/90">
                  0.00 = at Address A, 0.50 = true midpoint, 1.00 = at Address B.
                </p>
                <div className="mt-2 flex justify-between text-[11px] font-semibold uppercase tracking-wide text-emerald-300/80">
                  <span>Closer to A</span>
                  <span>Even (0.50)</span>
                  <span>Closer to B</span>
                </div>
              </label>

              <label className="flex items-center justify-between rounded-lg border border-emerald-700 bg-emerald-950/60 px-4 py-3">
                <span className="text-sm font-semibold text-emerald-100">Search the area for a specific spot?</span>
                <input
                  type="checkbox"
                  checked={enableAreaSearch}
                  onChange={(event) => setEnableAreaSearch(event.target.checked)}
                  className="h-5 w-5 accent-lime-400"
                />
              </label>

              {enableAreaSearch && (
                <div className="space-y-4 rounded-lg border border-emerald-700/80 bg-emerald-950/50 p-4">
                  <label className="block">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-semibold text-emerald-100">Circle radius</span>
                      <span className="rounded bg-emerald-800/80 px-2 py-1 text-xs font-semibold text-sky-200">
                        {radiusKm.toFixed(0)} km
                      </span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="50"
                      step="1"
                      value={radiusKm}
                      onChange={(event) => setRadiusKm(Number(event.target.value))}
                      className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-emerald-700 accent-sky-400"
                    />
                  </label>

                  <div>
                    <p className="mb-2 text-sm font-semibold text-emerald-100">Preferences</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {preferenceOptions.map((option) => (
                        <label
                          key={option.key}
                          className="flex items-center gap-2 rounded border border-emerald-700/70 px-3 py-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={selectedPreferences.includes(option.key)}
                            onChange={() => handlePreferenceToggle(option.key)}
                            className="h-4 w-4 accent-lime-400"
                          />
                          {option.label}
                        </label>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-emerald-300/90">
                      If no preferences are selected, all options are searched automatically.
                    </p>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-lime-500 px-4 py-3 font-semibold text-emerald-950 transition hover:bg-lime-400 disabled:cursor-not-allowed disabled:bg-lime-700"
              >
                {loading ? 'Searching…' : 'Find Midpoint'}
              </button>
            </form>

            <div className="mt-8 rounded-xl border border-emerald-700/80 bg-emerald-950/50 p-4 text-sm">
              {error ? (
                <p className="font-medium text-rose-300">{error}</p>
              ) : midpoint ? (
                <ul className="space-y-2 text-emerald-100">
                  <li>
                    <strong>Address A:</strong> {pointA?.displayName}
                  </li>
                  <li>
                    <strong>Address B:</strong> {pointB?.displayName}
                  </li>
                  <li>
                    <strong>Bias:</strong> {bias.toFixed(2)}
                  </li>
                  <li>
                    <strong>Adjusted midpoint:</strong> {midpoint.lat.toFixed(6)}, {midpoint.lon.toFixed(6)}
                  </li>
                  {enableAreaSearch && (
                    <li>
                      <strong>Found spots:</strong> {searchResults.length}
                    </li>
                  )}
                </ul>
              ) : (
                <p className="text-emerald-200/90">Results will appear here after calculation.</p>
              )}
            </div>
          </div>
        </section>

        <section className="h-[50vh] w-full md:h-screen md:w-1/2">
          <MapContainer center={defaultCenter} zoom={2} scrollWheelZoom className="h-full w-full">
            <TileLayer
              attribution='&copy; OpenStreetMap contributors &copy; CARTO'
              url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            />

            {mapPoints.length > 0 && <FitMapToPoints points={mapPoints} />}

            {pointA && pointB && (
              <Polyline
                positions={[
                  [pointA.lat, pointA.lon],
                  [pointB.lat, pointB.lon],
                ]}
                pathOptions={{ color: '#1f2937', weight: 8, dashArray: '16 12', lineCap: 'butt' }}
              />
            )}

            {enableAreaSearch && midpoint && (
              <Circle
                center={[midpoint.lat, midpoint.lon]}
                radius={radiusKm * 1000}
                pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#93c5fd', fillOpacity: 0.28 }}
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
                  Adjusted midpoint ({bias.toFixed(2)}): {midpoint.lat.toFixed(6)}, {midpoint.lon.toFixed(6)}
                </Popup>
              </Marker>
            )}

            {searchResults.map((spot) => (
              <Marker key={spot.id} position={[spot.lat, spot.lon]} icon={spotIcon}>
                <Popup>
                  <div className="space-y-1">
                    <p className="font-semibold">{spot.name}</p>
                    <p className="text-xs capitalize text-slate-700">{spot.amenity.replace('_', ' ')}</p>
                    <p className="text-xs">{spot.address}</p>
                    <a
                      href={spot.googleMapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-semibold text-blue-700 underline"
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
    </main>
  )
}
