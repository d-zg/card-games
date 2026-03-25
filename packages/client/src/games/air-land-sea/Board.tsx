import { useState } from "react";
import type {
  ALSView,
  ALSAction,
  Theater,
  PlayedCardView,
  PendingAbilityView,
} from "@card-games/shared/src/games/air-land-sea/types.js";
import { ALL_CARDS } from "@card-games/shared/src/games/air-land-sea/cards.js";
import { withdrawalPoints } from "@card-games/shared/src/games/air-land-sea/scoring.js";
import type { PlayerId } from "@card-games/shared";

const DEFAULT_THEATER_ORDER: Theater[] = ["air", "land", "sea"];
const THEATER_LABELS: Record<Theater, string> = { air: "Air", land: "Land", sea: "Sea" };
const THEATER_TINTS: Record<Theater, string> = {
  air: "rgba(255, 255, 255, 0)",
  land: "rgba(139, 90, 43, 0.06)",
  sea: "rgba(33, 150, 243, 0.06)",
};

interface BoardProps {
  view: ALSView;
  version: number;
  playerNames: Record<string, string>;
  playerWins: Record<string, number>;
  onAction: (action: ALSAction) => void;
  onPlayAgain?: () => void;
}

function getCardName(cardId: string | null): string {
  if (!cardId) return "???";
  const card = ALL_CARDS.find((c) => c.id === cardId);
  return card ? `${card.name} (${card.strength})` : cardId;
}

export function AirLandSeaBoard({ view, version, playerNames, playerWins, onAction, onPlayAgain }: BoardProps) {
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [playFaceUp, setPlayFaceUp] = useState(true);
  const [transportFrom, setTransportFrom] = useState<{ theater: Theater; cardIndex: number } | null>(null);

  const isMyTurn = view.myPlayerId === view.currentPlayer && !view.pendingAbility;
  const isMyAbilityTurn = view.pendingAbility !== null && view.pendingAbility.playerId === view.myPlayerId;
  const isTransportPending = isMyAbilityTurn && view.pendingAbility?.type === "transport";
  const opponent = view.myPlayerId === "player-0" ? "player-1" : "player-0";
  const isSpectator = view.myPlayerId === null;
  const myName = view.myPlayerId ? (playerNames[view.myPlayerId] ?? view.myPlayerId) : "Player 0";
  const opponentName = playerNames[opponent] ?? opponent;
  const myWins = view.myPlayerId ? (playerWins[view.myPlayerId] ?? 0) : 0;
  const opWins = playerWins[opponent] ?? 0;

  const canPlayInTheater = (theater: Theater): boolean => {
    if (!selectedCard || !isMyTurn) return false;
    if (!playFaceUp) return true; // face-down can go anywhere
    const card = ALL_CARDS.find((c) => c.id === selectedCard);
    if (!card) return false;
    if (card.theater === theater) return true; // matching theater always ok
    if (view.airDropActive) return true; // Air Drop: any theater
    if (view.aerodromeActive && card.strength <= 3) return true; // Aerodrome: str ≤ 3
    return false;
  };

  const handlePlayCard = (theater: Theater) => {
    if (!selectedCard || !isMyTurn || !canPlayInTheater(theater)) return;
    onAction({ type: "play", cardId: selectedCard, theater, faceUp: playFaceUp });
    setSelectedCard(null);
  };

  const handleWithdraw = () => {
    onAction({ type: "withdraw" });
  };

  const handleStartNextRound = () => {
    onAction({ type: "start-next-round" });
  };

  const handleFlipCard = (theater: Theater, cardOwner: PlayerId, cardIndex: number) => {
    if (!view.pendingAbility) return;
    const type = view.pendingAbility.type;
    if (type === "maneuver" || type === "ambush") {
      onAction({ type: "choose-flip", theater, cardOwner, cardIndex });
    } else if (type === "disrupt-opponent" || type === "disrupt-self") {
      onAction({ type: "choose-disrupt-flip", theater, cardIndex });
    }
  };

  const handleTransportSelect = (fromTheater: Theater, cardIndex: number) => {
    setTransportFrom({ theater: fromTheater, cardIndex });
  };

  const handleTransportDestination = (toTheater: Theater) => {
    if (!transportFrom) return;
    onAction({ type: "choose-transport", fromTheater: transportFrom.theater, cardIndex: transportFrom.cardIndex, toTheater });
    setTransportFrom(null);
  };

  const handleRedeploy = (theater: Theater, cardIndex: number) => {
    onAction({ type: "choose-redeploy", theater, cardIndex });
  };

  const handleReinforce = (play: boolean, theater?: Theater) => {
    onAction({ type: "choose-reinforce", play, theater });
  };

  return (
    <div style={{ width: "min(960px, 100%)", minWidth: 320, margin: "20px auto", padding: "0 clamp(8px, 2vw, 24px)", boxSizing: "border-box" }}>
      {/* Scores */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <strong>{myName}</strong>
          {!isSpectator && <span style={{ color: "#888" }}> (You)</span>}
          : <span style={{ color: "#2e7d32", fontWeight: "bold" }}>{view.scores[view.myPlayerId ?? "player-0"]} pts</span>
          {(myWins > 0 || opWins > 0) && <span style={{ color: "#888", fontSize: 12, marginLeft: 6 }}>{myWins}W</span>}
        </div>
        <div style={{ color: "#666" }}>Round {view.roundNumber}</div>
        <div>
          <strong>{opponentName}</strong>
          {!isSpectator && <span style={{ color: "#888" }}> (Opponent)</span>}
          : <span style={{ color: "#d32f2f", fontWeight: "bold" }}>{view.scores[opponent]} pts</span>
          {(myWins > 0 || opWins > 0) && <span style={{ color: "#888", fontSize: 12, marginLeft: 6 }}>{opWins}W</span>}
        </div>
      </div>

      {/* Status bar */}
      <StatusBar view={view} isMyTurn={isMyTurn} isMyAbilityTurn={isMyAbilityTurn} isSpectator={isSpectator} />

      {/* Opponent hand (card backs) */}
      {!isSpectator && (
        <div style={{ textAlign: "center", marginBottom: 12, color: "#666" }}>
          Opponent: {view.opponentHandSize} cards
        </div>
      )}

      {/* Theaters */}
      <div style={{ display: "flex", gap: "clamp(4px, 1vw, 12px)", marginBottom: 16 }}>
        {(view.theaterOrder ?? DEFAULT_THEATER_ORDER).map((theater) => (
          <TheaterColumn
            key={theater}
            theater={theater}
            view={view}
            opponent={opponent}
            canPlayHere={canPlayInTheater(theater)}
            isTransportPending={isTransportPending}
            transportFrom={transportFrom}
            onPlayCard={() => handlePlayCard(theater)}
            onFlipCard={(owner, idx) => handleFlipCard(theater, owner, idx)}
            onTransportSelect={(idx) => handleTransportSelect(theater, idx)}
            onTransportDestination={() => handleTransportDestination(theater)}
            onRedeploy={(idx) => handleRedeploy(theater, idx)}
          />
        ))}
      </div>

      {/* Pending ability UI */}
      {isMyAbilityTurn && view.pendingAbility && (
        <AbilityPanel
          ability={view.pendingAbility}
          onReinforce={handleReinforce}
        />
      )}

      {/* My hand */}
      {!isSpectator && view.myHand.length > 0 && view.phase === "playing" && (
        <div style={{ marginBottom: 16 }}>
          <h3>Your Hand</h3>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {view.myHand.map((cardId) => {
              const card = ALL_CARDS.find((c) => c.id === cardId)!;
              const isSelected = cardId === selectedCard;
              return (
                <button
                  key={cardId}
                  onClick={() => setSelectedCard(isSelected ? null : cardId)}
                  disabled={!isMyTurn}
                  style={{
                    padding: "10px 14px",
                    border: isSelected ? "2px solid #1976d2" : "1px solid #ccc",
                    borderRadius: 6,
                    background: isSelected ? "#e3f2fd" : "white",
                    cursor: isMyTurn ? "pointer" : "default",
                    fontSize: 14,
                    textAlign: "left",
                    flex: "1 1 180px",
                    maxWidth: 280,
                    minWidth: 0,
                    boxSizing: "border-box",
                  }}
                >
                  <div><strong>{card.name}</strong> <span style={{ fontSize: 13, color: "#888" }}>str {card.strength}</span></div>
                  <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{card.theater} · {card.abilityType !== "none" ? card.abilityType : ""}</div>
                  <div style={{ fontSize: 12, color: "#555", marginTop: 4, lineHeight: 1.3 }}>{card.abilityText}</div>
                </button>
              );
            })}
          </div>
          {selectedCard && isMyTurn && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
              <input
                type="checkbox"
                checked={playFaceUp}
                onChange={(e) => setPlayFaceUp(e.target.checked)}
              />
              Play face-up (click a theater above to play)
            </label>
          )}
        </div>
      )}

      {/* Withdraw button */}
      {isMyTurn && view.phase === "playing" && !view.pendingAbility && (
        <button
          onClick={handleWithdraw}
          style={{ padding: "8px 16px", background: "#f44336", color: "white", border: "none", borderRadius: 4 }}
        >
          Withdraw ({withdrawalPoints(view.myHand.length, view.isFirstPlayer)} pts to opponent)
        </button>
      )}

      {/* Round over / Game over */}
      {view.phase === "round-over" && (
        <div style={{ textAlign: "center", padding: 24 }}>
          <h2>{view.lastRoundWinner === view.myPlayerId ? "You won the round!" : "You lost the round."}</h2>
          <button onClick={handleStartNextRound} style={{ padding: 12, fontSize: 16 }}>
            Start Next Round
          </button>
        </div>
      )}

      {view.phase === "game-over" && (
        <div style={{ textAlign: "center", padding: 24 }}>
          <h2>Game Over!</h2>
          <p>
            Final Score: {myName} <span style={{ color: "#2e7d32" }}>{view.scores[view.myPlayerId ?? "player-0"]}</span> - <span style={{ color: "#d32f2f" }}>{view.scores[opponent]}</span> {opponentName}
          </p>
          <p style={{ fontSize: 20 }}>
            {view.lastRoundWinner === view.myPlayerId ? "You win!" : `${opponentName} wins!`}
          </p>
          {onPlayAgain && (
            <button onClick={onPlayAgain} style={{ padding: 12, fontSize: 16, marginTop: 12 }}>
              Play Again
            </button>
          )}
        </div>
      )}
      {/* Action Log */}
      {view.log.length > 0 && (
        <div style={{ marginTop: 16, padding: 12, background: "#fafafa", border: "1px solid #eee", borderRadius: 4, maxHeight: 160, overflowY: "auto" }}>
          <div style={{ fontSize: 12, fontWeight: "bold", marginBottom: 6, color: "#666" }}>Action Log</div>
          {view.log.map((entry, i) => {
            // Replace "You" and player IDs with display names
            let display = entry;
            for (const [id, name] of Object.entries(playerNames)) {
              display = display.replaceAll(id, name);
            }
            return (
              <div key={i} style={{ fontSize: 12, color: "#444", padding: "2px 0" }}>
                {display}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusBar({ view, isMyTurn, isMyAbilityTurn, isSpectator }: {
  view: ALSView;
  isMyTurn: boolean;
  isMyAbilityTurn: boolean;
  isSpectator: boolean;
}) {
  let text = "";
  let color = "#666";

  if (view.phase === "game-over") {
    text = "Game over";
  } else if (view.phase === "round-over") {
    text = "Round over";
  } else if (isSpectator) {
    text = `${view.currentPlayer}'s turn`;
  } else if (isMyAbilityTurn) {
    text = `Resolve ability: ${view.pendingAbility!.type}`;
    color = "#e65100";
  } else if (isMyTurn) {
    text = "Your turn — select a card and click a theater";
    color = "#1976d2";
  } else if (view.pendingAbility) {
    text = "Waiting for opponent to resolve ability...";
  } else {
    text = "Waiting for opponent...";
  }

  return (
    <div style={{ textAlign: "center", padding: 8, marginBottom: 12, color, fontWeight: "bold" }}>
      {text}
    </div>
  );
}

function TheaterColumn({ theater, view, opponent, canPlayHere, isTransportPending, transportFrom, onPlayCard, onFlipCard, onTransportSelect, onTransportDestination, onRedeploy }: {
  theater: Theater;
  view: ALSView;
  opponent: PlayerId;
  canPlayHere: boolean;
  isTransportPending: boolean;
  transportFrom: { theater: Theater; cardIndex: number } | null;
  onPlayCard: () => void;
  onFlipCard: (owner: PlayerId, index: number) => void;
  onTransportSelect: (index: number) => void;
  onTransportDestination: () => void;
  onRedeploy: (index: number) => void;
}) {
  const myStacks = view.myPlayerId ? view.theaters[theater].stacks[view.myPlayerId] : [];
  const opStacks = view.theaters[theater].stacks[opponent];
  const myStrength = view.myPlayerId ? view.theaterStrengths[theater][view.myPlayerId] : 0;
  const opStrength = view.theaterStrengths[theater][opponent];
  const isFlipTarget = view.pendingAbility?.type === "maneuver" || view.pendingAbility?.type === "ambush";
  const isDisruptTarget = view.pendingAbility?.type === "disrupt-opponent" || view.pendingAbility?.type === "disrupt-self";
  const isRedeployTarget = view.pendingAbility?.type === "redeploy";

  const canFlipInTheater = isFlipTarget && (
    view.pendingAbility?.type === "ambush" ||
    (view.pendingAbility?.type === "maneuver" && (view.pendingAbility as { adjacentTheaters: Theater[] }).adjacentTheaters.includes(theater))
  );

  // Transport: show "Move here" button when a card is selected and this is a different theater
  const showTransportDestination = transportFrom && transportFrom.theater !== theater;

  return (
    <div style={{ flex: "1 1 0", minWidth: 120, border: "1px solid #ccc", borderRadius: 4, padding: 8, minHeight: 200, background: THEATER_TINTS[theater] }}>
      <div style={{ textAlign: "center", fontWeight: "bold", marginBottom: 8 }}>
        {THEATER_LABELS[theater]}
      </div>
      <div style={{ textAlign: "center", fontSize: 13, marginBottom: 8 }}>
        <span style={{ color: opStrength > myStrength ? "#d32f2f" : opStrength === myStrength ? "#666" : "#999", fontWeight: opStrength >= myStrength ? "bold" : "normal" }}>
          {opStrength}
        </span>
        <span style={{ color: "#999", margin: "0 4px" }}>vs</span>
        <span style={{ color: myStrength > opStrength ? "#2e7d32" : myStrength === opStrength ? "#666" : "#999", fontWeight: myStrength >= opStrength ? "bold" : "normal" }}>
          {myStrength}
        </span>
      </div>

      {/* Opponent's cards (top card first visually) */}
      <div style={{ marginBottom: 8, minHeight: 40 }}>
        {[...opStacks].reverse().map((card, ri) => {
          const i = opStacks.length - 1 - ri; // original index
          return (
            <CardChip
              key={i}
              card={card}
              isClickable={!!(canFlipInTheater && view.myPlayerId)}
              isTopCard={i === opStacks.length - 1}
              onClick={() => onFlipCard(opponent, i)}
            />
          );
        })}
      </div>

      {/* Play zone */}
      {canPlayHere && (
        <button
          onClick={onPlayCard}
          style={{
            width: "100%", padding: 6, marginBottom: 8,
            border: "2px dashed #1976d2", background: "#e3f2fd",
            borderRadius: 4, cursor: "pointer", fontSize: 12,
          }}
        >
          Play here
        </button>
      )}

      {/* Transport destination zone */}
      {showTransportDestination && (
        <button
          onClick={onTransportDestination}
          style={{
            width: "100%", padding: 6, marginBottom: 8,
            border: "2px dashed #e65100", background: "#fff3e0",
            borderRadius: 4, cursor: "pointer", fontSize: 12,
          }}
        >
          Move here
        </button>
      )}

      {/* My cards (top card first visually) */}
      <div style={{ minHeight: 40 }}>
        {[...myStacks].reverse().map((card, ri) => {
          const i = myStacks.length - 1 - ri; // original index
          const isTransportSelectable = isTransportPending && !transportFrom;
          const isTransportSelected = transportFrom?.theater === theater && transportFrom?.cardIndex === i;
          const clickable =
            (isDisruptTarget) ||
            (isRedeployTarget && !card.faceUp) ||
            (isTransportSelectable) ||
            (canFlipInTheater && view.myPlayerId !== null);
          return (
            <CardChip
              key={i}
              card={card}
              isMine
              isClickable={clickable}
              isHighlighted={isTransportSelected}
              isTopCard={i === myStacks.length - 1}
              onClick={() => {
                if (isDisruptTarget) onFlipCard(view.myPlayerId!, i);
                else if (isRedeployTarget) onRedeploy(i);
                else if (isTransportSelectable) onTransportSelect(i);
                else if (canFlipInTheater) onFlipCard(view.myPlayerId!, i);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function CardChip({ card, isMine, isClickable, isHighlighted, isTopCard, onClick }: {
  card: PlayedCardView;
  isMine?: boolean;
  isClickable?: boolean;
  isHighlighted?: boolean;
  isTopCard?: boolean;
  onClick?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  // Colors: face-up mine=green, face-up opponent=red,
  // face-down mine=greenish gray, face-down opponent=reddish gray
  let bg: string;
  if (isHighlighted) {
    bg = "#ffe0b2";
  } else if (card.faceUp) {
    bg = isMine ? "#c8e6c9" : "#ffcdd2";
  } else {
    bg = isMine ? "#d5e8d4" : "#e8d4d4";
  }

  // Determine what's visible: face-up cards are visible to all, face-down only to owner
  const visibleCardId = card.faceUp ? card.cardId : (isMine ? card.cardId : null);
  const cardDef = visibleCardId ? ALL_CARDS.find((c) => c.id === visibleCardId) : null;
  const showDescription = isTopCard || expanded;

  const handleClick = () => {
    if (isClickable && onClick) {
      onClick();
    } else if (cardDef && !isTopCard) {
      setExpanded(!expanded);
    }
  };

  return (
    <div
      onClick={handleClick}
      style={{
        padding: "6px 8px",
        marginBottom: 4,
        background: bg,
        borderRadius: 4,
        fontSize: 12,
        cursor: isClickable || (!isTopCard && cardDef) ? "pointer" : "default",
        border: isHighlighted ? "2px solid #e65100" : isClickable ? "1px solid #1976d2" : "1px solid transparent",
      }}
    >
      {cardDef ? (
        <>
          <div>
            {isTopCard && <span style={{ fontSize: 9, color: "#888", fontWeight: "bold", marginRight: 4, textTransform: "uppercase" }}>top</span>}
            <strong>{cardDef.name}</strong>
            <span style={{ color: "#666", marginLeft: 4 }}>str {cardDef.strength}</span>
            {!card.faceUp && <span style={{ color: "#999", marginLeft: 4 }}>(face-down)</span>}
            {!isTopCard && !expanded && cardDef.abilityType !== "none" && <span style={{ color: "#aaa", marginLeft: 4 }}>...</span>}
          </div>
          {showDescription && cardDef.abilityType !== "none" && (
            <div style={{ fontSize: 10, color: "#555", marginTop: 2, lineHeight: 1.3 }}>
              {cardDef.abilityText}
            </div>
          )}
        </>
      ) : (
        <div>
          {isTopCard && <span style={{ fontSize: 9, color: "#888", fontWeight: "bold", marginRight: 4, textTransform: "uppercase" }}>top</span>}
          Face-down
        </div>
      )}
    </div>
  );
}

function AbilityPanel({ ability, onReinforce }: {
  ability: PendingAbilityView;
  onReinforce: (play: boolean, theater?: Theater) => void;
}) {
  if (ability.type === "maneuver") {
    return (
      <div style={{ padding: 12, background: "#fff3e0", borderRadius: 4, marginBottom: 16 }}>
        <strong>Maneuver:</strong> Click a card in {ability.adjacentTheaters.join(" or ")} to flip it.
      </div>
    );
  }
  if (ability.type === "ambush") {
    return (
      <div style={{ padding: 12, background: "#fff3e0", borderRadius: 4, marginBottom: 16 }}>
        <strong>Ambush:</strong> Click any card on the board to flip it.
      </div>
    );
  }
  if (ability.type === "transport") {
    return (
      <div style={{ padding: 12, background: "#fff3e0", borderRadius: 4, marginBottom: 16 }}>
        <strong>Transport:</strong> Click one of your cards, then click a theater to move it there.
      </div>
    );
  }
  if (ability.type === "reinforce") {
    return (
      <div style={{ padding: 12, background: "#fff3e0", borderRadius: 4, marginBottom: 16 }}>
        <strong>Reinforce:</strong> Top card is {ability.topCard ? getCardName(ability.topCard) : "unknown"}.
        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
          {ability.adjacentTheaters.map((t) => (
            <button key={t} onClick={() => onReinforce(true, t)}>Play to {THEATER_LABELS[t]}</button>
          ))}
          <button onClick={() => onReinforce(false)}>Put back</button>
        </div>
      </div>
    );
  }
  if (ability.type === "redeploy") {
    return (
      <div style={{ padding: 12, background: "#fff3e0", borderRadius: 4, marginBottom: 16 }}>
        <strong>Redeploy:</strong> Click one of your face-down cards to pick it up.
      </div>
    );
  }
  if (ability.type === "disrupt-opponent") {
    return (
      <div style={{ padding: 12, background: "#fff3e0", borderRadius: 4, marginBottom: 16 }}>
        <strong>Disrupt:</strong> You must flip one of your own cards. Click a card to flip it.
      </div>
    );
  }
  if (ability.type === "disrupt-self") {
    return (
      <div style={{ padding: 12, background: "#fff3e0", borderRadius: 4, marginBottom: 16 }}>
        <strong>Disrupt:</strong> Now flip one of your own cards. Click a card to flip it.
      </div>
    );
  }
  return null;
}
