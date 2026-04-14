export class CostMeter {
  private turn = 0;
  private total = 0;
  beginTurn(): void {
    this.turn = 0;
  }
  endTurn(): void {
    /* totals kept live via add() */
  }
  add(usd: number): void {
    this.turn += usd;
    this.total += usd;
  }
  currentTurn(): number {
    return this.turn;
  }
  session(): number {
    return this.total;
  }
}
