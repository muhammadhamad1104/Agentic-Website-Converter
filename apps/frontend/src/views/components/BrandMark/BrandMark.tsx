import './BrandMark.css';

export default function BrandMark({ size = 28 }: { size?: number }) {
  return <span className="brand-mark" aria-hidden="true" style={{ width: size, height: size }} />;
}
