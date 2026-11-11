// Physical constants and beam quantities. Units: A, kV, rad.
export const M0C2_KEV = 510.99895; // electron rest energy (keV)
const HC_KEV_A = 12.398419843; // h*c in keV*A
/** h^2 / (2 pi m0 e) in V*A^2: converts f_e (A) / cell volume (A^3) into a potential coefficient (V). */
export const VOLT_A2 = 47.87801;

/** Relativistic electron wavelength (A). */
export function wavelength(kV: number): number {
  return HC_KEV_A / Math.sqrt(kV * (2 * M0C2_KEV + kV));
}
/** Relativistic mass ratio gamma = 1 + eV / m0c^2. */
export function gammaRel(kV: number): number {
  return 1 + kV / M0C2_KEV;
}
/** Interaction parameter sigma (rad / (V*A)), Kirkland eq. 5.6. */
export function sigmaInteraction(kV: number): number {
  const lam = wavelength(kV);
  return ((2 * Math.PI) / (lam * kV * 1e3)) * ((M0C2_KEV + kV) / (2 * M0C2_KEV + kV));
}
