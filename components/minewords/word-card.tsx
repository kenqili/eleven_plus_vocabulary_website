/**
 * The word details a game reveals after an answer.
 *
 * Shared by the relation games and the mixed-practice game: the same four
 * facts are what a child needs to see when a word is missed, and having one
 * card means the definition, example and two relation lists cannot drift
 * between the games.
 */
export type WordDetails = {
  definition: string;
  example: string;
  synonyms: string[];
  antonyms: string[];
};

export default function WordCard({ word }: { word: WordDetails }) {
  return (
    <div className="relation-card-details">
      <p className="relation-definition">{word.definition}</p>
      {word.example ? (
        <p className="relation-example">“{word.example}”</p>
      ) : null}
      <div className="relation-relations">
        <div>
          <span className="relation-relation-label">Synonyms</span>
          {word.synonyms.length ? (
            <ul>
              {word.synonyms.map((entry) => (
                <li key={entry}>{entry}</li>
              ))}
            </ul>
          ) : (
            <p className="relation-none">None recorded.</p>
          )}
        </div>
        <div>
          <span className="relation-relation-label">Antonyms</span>
          {word.antonyms.length ? (
            <ul>
              {word.antonyms.map((entry) => (
                <li key={entry}>{entry}</li>
              ))}
            </ul>
          ) : (
            <p className="relation-none">None recorded.</p>
          )}
        </div>
      </div>
    </div>
  );
}
