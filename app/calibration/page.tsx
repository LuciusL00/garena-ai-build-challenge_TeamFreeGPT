import CalibrationClient from './calibration-client.tsx';
import './calibration.css';

export const dynamic = 'force-static';

export const metadata = {
  title: 'Input Performance Test',
  description: 'Compare the reliability, response time and accidental activations of two controls.',
};

export default function CalibrationPage() {
  return <CalibrationClient />;
}
