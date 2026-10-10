import { lazy, Suspense } from 'react';

const CinematicScene = lazy(() => import('../../../components/CinematicScene/CinematicScene'));

export default function ConversionVisual() {
  return <div className="conversion-visual" aria-hidden="true">
    <div className="conversion-visual-scene"><Suspense fallback={<img className="conversion-visual-fallback" src="/media/pavilion.webp" alt="" />}><CinematicScene compact /></Suspense></div>
  </div>;
}
