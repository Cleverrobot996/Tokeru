fn main() {
    let path = std::env::args().nth(1).unwrap();
    let c = rusqlite::Connection::open(&path).unwrap();
    c.execute_batch("create table if not exists t(x); insert into t values(1);").unwrap();
    println!("ok {}", c.query_row("select count(*) from t", [], |r| r.get::<_, i64>(0)).unwrap());
}
