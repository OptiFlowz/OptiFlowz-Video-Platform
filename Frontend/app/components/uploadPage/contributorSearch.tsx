import { useState, useRef, useEffect, useLayoutEffect, memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchFn } from "~/API";

interface Contributor {
  id: string;
  name: string;
  image_url?: string;
}

interface ContributorSearchProps {
  label: string;
  selectedContributors: Contributor[];
  onAdd: (contributor: Contributor) => void;
  onRemove: (id: string) => void;
  placeholder?: string;
}

function ContributorSearch({
  label,
  selectedContributors,
  onAdd,
  onRemove,
  placeholder = "Search contributors...",
}: ContributorSearchProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [token, setToken] = useState<string | undefined>(undefined);
  const myHeaders = useRef(new Headers());
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const user = localStorage.getItem("user");
    if (user) {
      const parsedToken = JSON.parse(user).token;
      setToken(parsedToken);
      myHeaders.current.set("Authorization", `Bearer ${parsedToken}`);
    }
  }, []);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["contributors-search", debouncedQuery],
    queryFn: () =>
      fetchFn<{ people: Contributor[] }>({
        route: `api/people/search?q=${encodeURIComponent(debouncedQuery)}`,
        options: { method: "GET", headers: myHeaders.current },
      }),
    enabled: !!token && debouncedQuery.length >= 2,
  });

  const handleSelect = (contributor: Contributor) => {
    if (!selectedContributors.some((c) => c.id === contributor.id)) {
      onAdd(contributor);
    }
    setQuery("");
    setIsOpen(false);
  };

  const filteredResults =
    data?.people?.filter(
      (person) => !selectedContributors.some((c) => c.id === person.id)
    ) ?? [];

  return (
    <div className="formGroup" ref={containerRef}>
      <label>{label}</label>
      <div className="contributorSearchContainer">
        <div className="selectedContributors">
          {selectedContributors.map((contributor) => (
            <span key={contributor.id} className="contributorChip">
              {contributor.image_url && (
                <img
                  src={contributor.image_url}
                  alt={contributor.name}
                  className="contributorChipImage"
                />
              )}
              {contributor.name}
              <button
                type="button"
                className="removeContributorBtn"
                onClick={() => onRemove(contributor.id)}
              >
                ×
              </button>
            </span>
          ))}
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            placeholder={selectedContributors.length === 0 ? placeholder : ""}
            className="contributorInput"
          />
        </div>

        {isOpen && debouncedQuery.length >= 2 && (
          <div className="contributorDropdown">
            {isLoading ? (
              <div className="dropdownItem loading">Searching...</div>
            ) : filteredResults.length > 0 ? (
              filteredResults.map((person) => (
                <button
                  key={person.id}
                  type="button"
                  className="dropdownItem"
                  onClick={() => handleSelect(person)}
                >
                  {person.image_url && (
                    <img
                      src={person.image_url}
                      alt={person.name}
                      className="dropdownItemImage"
                    />
                  )}
                  <span>{person.name}</span>
                </button>
              ))
            ) : (
              <div className="dropdownItem noResults">No results found</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(ContributorSearch);
