Pod::Spec.new do |s|
  s.name           = 'Boomerang'
  s.version        = '0.1.0'
  s.summary        = 'Forward-then-reverse video for stories'
  s.description    = 'Reads a short clip and writes it forward then backward into one H.264 file.'
  s.author         = 'Platinum Circles'
  s.homepage       = 'https://platinumcircles.com'
  s.license        = { :type => 'Proprietary' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = "**/*.{h,m,mm,swift}"
end