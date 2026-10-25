#include <cmath>
#include <ctime>
#include <iomanip>
#include <iostream>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>

namespace {
class Parser {
 public:
  explicit Parser(const std::string& input) : input_(input) {}
  double parse() {
    const double value = expression();
    skip();
    if (pos_ != input_.size()) throw std::runtime_error("Unexpected character in expression.");
    if (!std::isfinite(value)) throw std::runtime_error("Result is not finite.");
    return value;
  }
 private:
  const std::string& input_;
  std::size_t pos_ = 0;
  void skip() { while (pos_ < input_.size() && std::isspace(static_cast<unsigned char>(input_[pos_]))) ++pos_; }
  bool take(char c) { skip(); if (pos_ < input_.size() && input_[pos_] == c) { ++pos_; return true; } return false; }
  double expression() {
    double v = term();
    for (;;) { if (take('+')) v += term(); else if (take('-')) v -= term(); else return v; }
  }
  double term() {
    double v = power();
    for (;;) {
      if (take('*')) v *= power();
      else if (take('/')) { double d = power(); if (d == 0) throw std::runtime_error("Division by zero."); v /= d; }
      else if (take('%')) { double d = power(); if (d == 0) throw std::runtime_error("Modulo by zero."); v = std::fmod(v, d); }
      else return v;
    }
  }
  double power() {
    double v = unary();
    if (take('^')) v = std::pow(v, power());
    if (!std::isfinite(v)) throw std::runtime_error("Invalid arithmetic result.");
    return v;
  }
  double unary() {
    if (take('+')) return unary();
    if (take('-')) return -unary();
    if (take('(')) { double v = expression(); if (!take(')')) throw std::runtime_error("Missing closing parenthesis."); return v; }
    skip();
    const std::size_t begin = pos_;
    while (pos_ < input_.size() && (std::isdigit(static_cast<unsigned char>(input_[pos_])) || input_[pos_] == '.')) ++pos_;
    if (begin == pos_) throw std::runtime_error("Expected a number.");
    std::size_t used = 0;
    const double value = std::stod(input_.substr(begin, pos_ - begin), &used);
    if (used != pos_ - begin) throw std::runtime_error("Invalid number.");
    return value;
  }
};

double number(const std::string& s) {
  std::size_t used = 0;
  double v = std::stod(s, &used);
  if (used != s.size() || !std::isfinite(v)) throw std::runtime_error("A finite numeric value is required.");
  return v;
}
std::string format(double v) {
  std::ostringstream out;
  out << std::setprecision(12) << v;
  return out.str();
}
std::string lower(std::string s) {
  for (char& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return s;
}
double convert(double value, const std::string& fromRaw, const std::string& toRaw) {
  const std::string from = lower(fromRaw), to = lower(toRaw);
  const std::unordered_map<std::string, double> factors = {
    {"m",1.0},{"meter",1.0},{"meters",1.0},{"km",1000.0},{"kilometer",1000.0},{"kilometers",1000.0},
    {"cm",0.01},{"centimeter",0.01},{"centimeters",0.01},{"mm",0.001},{"millimeter",0.001},{"millimeters",0.001},
    {"mi",1609.344},{"mile",1609.344},{"miles",1609.344},{"ft",0.3048},{"foot",0.3048},{"feet",0.3048},
    {"in",0.0254},{"inch",0.0254},{"inches",0.0254},{"yd",0.9144},{"yard",0.9144},{"yards",0.9144},
    {"kg",1.0},{"kilogram",1.0},{"kilograms",1.0},{"g",0.001},{"gram",0.001},{"grams",0.001},
    {"mg",0.000001},{"milligram",0.000001},{"milligrams",0.000001},{"lb",0.45359237},{"lbs",0.45359237},{"pound",0.45359237},{"pounds",0.45359237},
    {"oz",0.028349523125},{"ounce",0.028349523125},{"ounces",0.028349523125},
    {"l",1.0},{"liter",1.0},{"liters",1.0},{"ml",0.001},{"milliliter",0.001},{"milliliters",0.001},
    {"gal",3.785411784},{"gallon",3.785411784},{"gallons",3.785411784}
  };
  if (from == to) return value;
  if ((from == "c" || from == "°c" || from == "celsius") && (to == "f" || to == "°f" || to == "fahrenheit")) return value * 9.0 / 5.0 + 32.0;
  if ((from == "f" || from == "°f" || from == "fahrenheit") && (to == "c" || to == "°c" || to == "celsius")) return (value - 32.0) * 5.0 / 9.0;
  if ((from == "c" || from == "°c" || from == "celsius") && (to == "k" || to == "kelvin")) return value + 273.15;
  if ((from == "k" || from == "kelvin") && (to == "c" || to == "°c" || to == "celsius")) return value - 273.15;
  if ((from == "f" || from == "°f" || from == "fahrenheit") && (to == "k" || to == "kelvin")) return (value - 32.0) * 5.0 / 9.0 + 273.15;
  if ((from == "k" || from == "kelvin") && (to == "f" || to == "°f" || to == "fahrenheit")) return (value - 273.15) * 9.0 / 5.0 + 32.0;
  auto a = factors.find(from), b = factors.find(to);
  if (a == factors.end() || b == factors.end()) throw std::runtime_error("Unsupported unit. Supported families: length, mass, volume, and temperature.");
  const bool lengthA = factors.count(from) && (from=="m"||from=="meter"||from=="meters"||from=="km"||from=="kilometer"||from=="kilometers"||from=="cm"||from=="centimeter"||from=="centimeters"||from=="mm"||from=="millimeter"||from=="millimeters"||from=="mi"||from=="mile"||from=="miles"||from=="ft"||from=="foot"||from=="feet"||from=="in"||from=="inch"||from=="inches"||from=="yd"||from=="yard"||from=="yards");
  const bool lengthB = (to=="m"||to=="meter"||to=="meters"||to=="km"||to=="kilometer"||to=="kilometers"||to=="cm"||to=="centimeter"||to=="centimeters"||to=="mm"||to=="millimeter"||to=="millimeters"||to=="mi"||to=="mile"||to=="miles"||to=="ft"||to=="foot"||to=="feet"||to=="in"||to=="inch"||to=="inches"||to=="yd"||to=="yard"||to=="yards");
  const bool massA = (from=="kg"||from=="kilogram"||from=="kilograms"||from=="g"||from=="gram"||from=="grams"||from=="mg"||from=="milligram"||from=="milligrams"||from=="lb"||from=="lbs"||from=="pound"||from=="pounds"||from=="oz"||from=="ounce"||from=="ounces");
  const bool massB = (to=="kg"||to=="kilogram"||to=="kilograms"||to=="g"||to=="gram"||to=="grams"||to=="mg"||to=="milligram"||to=="milligrams"||to=="lb"||to=="lbs"||to=="pound"||to=="pounds"||to=="oz"||to=="ounce"||to=="ounces");
  const bool volumeA = (from=="l"||from=="liter"||from=="liters"||from=="ml"||from=="milliliter"||from=="milliliters"||from=="gal"||from=="gallon"||from=="gallons");
  const bool volumeB = (to=="l"||to=="liter"||to=="liters"||to=="ml"||to=="milliliter"||to=="milliliters"||to=="gal"||to=="gallon"||to=="gallons");
  if ((lengthA != lengthB) || (massA != massB) || (volumeA != volumeB)) throw std::runtime_error("Cannot convert between different unit families.");
  return value * a->second / b->second;
}
}

int main(int argc, char** argv) {
  try {
    if (argc < 2) throw std::runtime_error("A tool name is required.");
    const std::string tool = argv[1];
    if (tool == "Calculator") {
      if (argc != 3) throw std::runtime_error("Calculator requires one expression argument.");
      std::cout << "{\"ok\":true,\"result\":" << format(Parser(argv[2]).parse()) << "}\n";
    } else if (tool == "UnitConvert") {
      if (argc != 5) throw std::runtime_error("UnitConvert requires value, from, and to arguments.");
      const double value = number(argv[2]);
      std::cout << "{\"ok\":true,\"value\":" << format(convert(value, argv[3], argv[4])) << ",\"from\":\"" << argv[3] << "\",\"to\":\"" << argv[4] << "\"}\n";
    } else if (tool == "CurrentTime") {
      const std::time_t now = std::time(nullptr);
      std::tm utc{};
#ifdef _WIN32
      gmtime_s(&utc, &now);
#else
      gmtime_r(&now, &utc);
#endif
      char buf[32]{};
      std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &utc);
      std::cout << "{\"ok\":true,\"utc\":\"" << buf << "\"}\n";
    } else if (tool == "TextStats") {
      if (argc != 3) throw std::runtime_error("TextStats requires one text argument.");
      const std::string text = argv[2];
      std::size_t words = 0;
      bool inWord = false;
      for (unsigned char c : text) {
        if (std::isspace(c)) inWord = false;
        else if (!inWord) { ++words; inWord = true; }
      }
      std::cout << "{\"ok\":true,\"characters\":" << text.size() << ",\"words\":" << words << "}\n";
    } else {
      throw std::runtime_error("Unknown C++ tool: " + tool);
    }
  } catch (const std::exception& e) {
    std::string message = e.what();
    for (char& c : message) if (c == '"' || c == '\\') c = ' ';
    std::cout << "{\"ok\":false,\"error\":\"" << message << "\"}\n";
    return 1;
  }
  return 0;
}
