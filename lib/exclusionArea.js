class ExclusionArea {
  constructor (point1, point2) {
    this.y = [point1.y, point2.y].sort((a, b) => a - b)
    this.x = [point1.x, point2.x].sort((a, b) => a - b)
    this.z = [point1.z, point2.z].sort((a, b) => a - b)
    console.log(this)
  }

  insideArea (point) {
    return (
      point.x > this.x[0] && point.x < this.x[1] &&
      point.y > this.y[0] && point.y < this.y[1] &&
      point.z > this.z[0] && point.z < this.z[1]
    )
  }
}

module.exports = ExclusionArea
