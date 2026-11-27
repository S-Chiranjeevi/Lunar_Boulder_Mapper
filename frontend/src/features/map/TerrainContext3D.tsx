import { useMemo } from 'react';
import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import type { ImageMetadata } from '../../app/types/contracts';
import type { DetectionWithGeo, ElevationGridData } from './types';

interface TerrainContext3DProps {
  imageMetadata: ImageMetadata;
  detections: DetectionWithGeo[];
  elevationData?: ElevationGridData | null;
}

function DemSurfaceMesh({
  elevationData,
  widthM,
  heightM,
}: {
  elevationData: ElevationGridData;
  widthM: number;
  heightM: number;
}) {
  const geometry = useMemo(() => {
    const segX = Math.max(1, elevationData.width - 1);
    const segY = Math.max(1, elevationData.height - 1);
    const geom = new THREE.PlaneGeometry(widthM, heightM, segX, segY);
    geom.rotateX(-Math.PI / 2);

    const pos = geom.attributes.position;
    const minH = Math.min(...elevationData.heights_m);
    for (let i = 0; i < pos.count && i < elevationData.heights_m.length; i += 1) {
      pos.setY(i, elevationData.heights_m[i] - minH);
    }
    geom.computeVertexNormals();
    return geom;
  }, [elevationData, widthM, heightM]);

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial color="#64748b" wireframe={false} roughness={0.9} metalness={0.05} />
    </mesh>
  );
}

/**
 * Optional 3D context mode. Renders DEM terrain ONLY when real elevation data
 * is supplied; otherwise displays a clearly marked flat 2D schematic plane and
 * never invents boulder heights.
 */
export function TerrainContext3D({
  imageMetadata,
  detections,
  elevationData,
}: TerrainContext3DProps) {
  const hasRealDem =
    Boolean(elevationData) &&
    elevationData!.width > 1 &&
    elevationData!.height > 1 &&
    elevationData!.heights_m.length === elevationData!.width * elevationData!.height;

  const scaleX = imageMetadata.gsd_x_m_per_px ?? 1;
  const scaleY = imageMetadata.gsd_y_m_per_px ?? 1;
  const planeW = 20;
  const planeH = 20 * (imageMetadata.height_px * scaleY) / Math.max(1, imageMetadata.width_px * scaleX);

  return (
    <div className="flex flex-col gap-2">
      <div className="px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-950/30 text-[11px] text-amber-100">
        {hasRealDem ? (
          <span>
            <strong>3D Context (Real DEM: {elevationData!.source}):</strong> Terrain relief uses
            real elevation values ({elevationData!.units}). Boulder 3D heights are not inferred
            from 2D NAC boxes; markers represent 2D projected footprints only.
          </span>
        ) : (
          <span>
            <strong>Flat 2D Context Schematic (No DEM/DTM Attached):</strong> Real elevation data is
            unavailable for this scene. Showing an explicitly flat reference plane only—no terrain
            relief or boulder heights are invented.
          </span>
        )}
      </div>

      <div className="h-[460px] rounded-xl overflow-hidden border border-slate-700 bg-[#070a10]">
        <Canvas camera={{ position: [0, 18, 18], fov: 45 }}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[12, 20, 10]} intensity={0.9} />

          {hasRealDem ? (
            <DemSurfaceMesh elevationData={elevationData!} widthM={planeW} heightM={planeH} />
          ) : (
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[planeW, planeH]} />
              <meshStandardMaterial color="#1e293b" roughness={0.95} />
            </mesh>
          )}

          <gridHelper args={[Math.max(planeW, planeH), 20, '#334155', '#1e293b']} />

          {detections.map((det) => {
            const cx = ((det.bbox_px[0] + det.bbox_px[2]) / 2 / imageMetadata.width_px - 0.5) * planeW;
            const cz = ((det.bbox_px[1] + det.bbox_px[3]) / 2 / imageMetadata.height_px - 0.5) * planeH;
            const radius = Math.max(
              0.12,
              ((det.bbox_px[2] - det.bbox_px[0]) / imageMetadata.width_px) * planeW * 0.5,
            );
            return (
              <mesh key={det.detection_id} position={[cx, 0.03, cz]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[radius * 0.65, radius, 24]} />
                <meshBasicMaterial color={det.position.uncertain ? '#a855f7' : '#38bdf8'} />
              </mesh>
            );
          })}

          <OrbitControls enableDamping />
        </Canvas>
      </div>
    </div>
  );
}
