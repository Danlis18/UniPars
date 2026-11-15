"""Генерує SQL-міграцію з навчальних планів факультету електроніки ЛНУ."""
import json
import re
import sys

src, out = sys.argv[1], sys.argv[2]
d = json.load(open(src, encoding="utf-8"))

PROGRAM = {  # сторінка навчального плану → шифр спеціальності
    "curriculum-software-engineering": ("F2", "Інженерія програмного забезпечення"),
    "curriculum-computer-technologies-2018": ("F3", "Комп'ютерні науки"),
    "curriculum-it-technologies": ("F6", "Інформаційні системи і технології"),
    "navchalnyy-plan-elektronika-ta-komp-iuterni-systemy": ("G5", "Електроніка та комп'ютерні системи"),
    "curriculum-micro-and-nanotechnics": ("G7", "Сенсорні і діагностичні автоматизовані системи"),
}
URL = "https://electronics.lnu.edu.ua/academics/bachelor/{}/"
SKIP = re.compile(r"Фізичне виховання|практика|Кваліфікаційна робота|Атестаційний екзамен|Курсова", re.I)

TR = dict(zip("абвгґдеєжзиіїйклмнопрстуфхцчшщьюя", ["a", "b", "v", "h", "g", "d", "e", "ie", "zh", "z", "y", "i", "i", "i", "k", "l", "m", "n", "o", "p", "r", "s", "t", "u", "f", "kh", "ts", "ch", "sh", "shch", "", "iu", "ia"]))


def norm(name: str) -> str:
    name = name.replace("’", "'").replace("ʼ", "'").replace("`", "'")
    name = re.sub(r"\s+", " ", name).strip(" .")
    name = re.sub(r"\s*\(Хмарні засоби та технології 2022\)", "", name)
    name = re.sub(r"Об'єктно орієнтоване", "Об'єктно-орієнтоване", name)
    name = re.sub(r"ч\.\s*(\d)", r"(ч. \1)", name)
    name = re.sub(r"на\w{0,2}олишнього", "навколишнього", name).replace("діагностистики", "діагностики")
    return name[0].upper() + name[1:] if name else name


def slugify(name: str) -> str:
    s = "".join(TR.get(ch, ch) for ch in name.lower())
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:60].strip("-")


MANUAL = {}


def split_electives(text: str) -> list[str]:
    text = re.sub(r"^Дисципліна на вибір\s*\d+\s*:\s*", "", text)
    # злиплі назви: «...системиВеликі дані» → межа малої та великої літери без пробілу
    parts = re.split(r"(?<=[а-яіїєґa-z\)])(?=[А-ЯІЇЄҐA-Z][а-яіїєґa-z])", text)
    # кілька вибіркових через пробіл: «...систем Мова програмування Python»
    parts = [x for part in parts for x in re.split(r"(?<=[а-яіїєґ]) (?=Мова програмування)", part)]
    out = []
    for p in parts:
        n = norm(p)
        out.extend(MANUAL.get(n, [n]) if n else [])
    return out


# Злиплі вибіркові дисципліни, які не розділяються автоматично (на сайті — без роздільника)
MANUAL = {
    "Інноваційний менеджмент Управління бізнес процесами": ["Інноваційний менеджмент", "Управління бізнес-процесами"],
    "Наноелектронні системи Температурні сенсори та системи термометрії": ["Наноелектронні системи", "Температурні сенсори та системи термометрії"],
    "Технології та засоби Інтернету речей Технологічні вимірювання та прилади": ["Технології та засоби Інтернету речей", "Технологічні вимірювання та прилади"],
}


subjects: dict[str, dict] = {}  # norm name → {"slug":, "links": {code: {"sems": set, "elective": bool}}}
for page, sems in d.items():
    code, _ = PROGRAM[page]
    for sem, block in sems.items():
        if not sem.isdigit():
            continue
        for row in block["rows"]:
            raw = row["name"]
            elective = raw.lower().startswith("дисципліна на вибір")
            for name in split_electives(raw):
                if SKIP.search(name) or len(name) < 3:
                    continue
                key = name.lower()
                s = subjects.setdefault(key, {"name": name, "links": {}})
                link = s["links"].setdefault(code, {"sems": set(), "elective": elective})
                link["sems"].add(int(sem))
                link["elective"] = link["elective"] and elective

# унікальні slug
used = set()
for s in subjects.values():
    base = slugify(s["name"]) or "subject"
    slug, i = base, 2
    while slug in used:
        slug, i = f"{base}-{i}", i + 1
    used.add(slug)
    s["slug"] = slug


def q(v: str) -> str:
    return "'" + v.replace("'", "''") + "'"


rows = []
for s in sorted(subjects.values(), key=lambda x: x["name"]):
    for code, l in sorted(s["links"].items()):
        sems = sorted(l["sems"])
        courses = sorted({(x + 1) // 2 for x in sems})
        rows.append(f"    ({q(s['slug'])}, {q(s['name'])}, {q(code)}, "
                    f"array[{','.join(map(str, sems))}]::smallint[], array[{','.join(map(str, courses))}]::smallint[], "
                    f"{'true' if l['elective'] else 'false'})")

sql = f"""-- UniPars: навчальні плани бакалаврату факультету електроніки та комп'ютерних технологій ЛНУ.
-- ЗГЕНЕРОВАНО з офіційних сторінок навчальних планів факультету:
{chr(10).join('--   ' + code + ' ' + name + ': ' + URL.format(p) for p, (code, name) in PROGRAM.items())}
-- Предмет з однаковою назвою в різних програмах — один запис, прив'язаний до кількох спеціальностей.
-- Не включено: фізвиховання, практики, кваліфікаційна робота, атестація.
-- Безпечно запускати повторно.

alter table subject_programs add column if not exists semesters smallint[];
alter table subject_programs add column if not exists courses smallint[];
alter table subject_programs add column if not exists is_elective boolean not null default false;

do $$
declare
  uni uuid;
  r record;
  sid uuid;
  pid uuid;
begin
  select id into uni from universities where slug = 'lnu';
  if uni is null then raise exception 'Спершу застосуйте міграцію 20261112000003 (каталог ЛНУ)'; end if;

  -- Назви освітніх програм у межах спеціальностей
{chr(10).join(f"  update programs set name = {q(name)} where university_id = uni and code = {q(code)};" for code, name in PROGRAM.values())}

  create temp table cur (slug text, name text, code text, semesters smallint[], courses smallint[], is_elective boolean) on commit drop;
  insert into cur values
{(','+chr(10)).join(rows)};

  -- Предмети: збіг за назвою (без регістру) або за slug; інакше — новий
  for r in select distinct on (lower(name)) slug, name from cur order by lower(name), slug loop
    select id into sid from subjects where university_id = uni and (lower(name) = lower(r.name) or slug = r.slug) limit 1;
    if sid is null then
      insert into subjects (university_id, slug, name, description) values (uni, r.slug, r.name, '') returning id into sid;
    end if;
  end loop;

  -- Прив'язки до спеціальностей перебудовуються з нуля за навчальним планом
  delete from subject_programs where university_id = uni;
  for r in select * from cur loop
    select id into sid from subjects where university_id = uni and (lower(name) = lower(r.name) or slug = r.slug) limit 1;
    select id into pid from programs where university_id = uni and code = r.code;
    insert into subject_programs (subject_id, program_id, university_id, course, semester, semesters, courses, is_elective)
    values (sid, pid, uni, r.courses[1], r.semesters[1], r.semesters, r.courses, r.is_elective)
    on conflict (subject_id, program_id) do update
      set semesters = excluded.semesters, courses = excluded.courses, is_elective = excluded.is_elective,
          course = excluded.course, semester = excluded.semester;
  end loop;

  -- Старі предмети, яких немає в навчальних планах і під якими немає дописів, прибираємо
  delete from subjects s where s.university_id = uni
    and not exists (select 1 from subject_programs sp where sp.subject_id = s.id)
    and not exists (select 1 from posts p where p.subject_id = s.id);
end $$;
"""
open(out, "w", encoding="utf-8").write(sql)
print(len(subjects), "subjects,", len(rows), "links")
for s in list(sorted(subjects.values(), key=lambda x: x["name"]))[:400]:
    pass
