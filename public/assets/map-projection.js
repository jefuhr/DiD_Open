export function worldX(longitude) { return (longitude + 180) / 360; }
export function worldY(latitude) {
  const sine = Math.sin(latitude * Math.PI / 180);
  return 0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI);
}
