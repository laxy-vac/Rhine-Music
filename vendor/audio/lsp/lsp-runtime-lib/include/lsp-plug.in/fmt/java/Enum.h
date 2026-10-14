/*
 * Copyright (C) 2020 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2020 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 5 сент. 2019 г.
 *
 * lsp-runtime-lib is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * lsp-runtime-lib is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with lsp-runtime-lib. If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef LSP_PLUG_IN_FMT_JAVA_ENUM_H_
#define LSP_PLUG_IN_FMT_JAVA_ENUM_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/runtime/LSPString.h>
#include <lsp-plug.in/fmt/java/Object.h>

namespace lsp
{
    namespace java
    {
        
        class Enum: public Object
        {
            public:
                static const char *CLASS_NAME;

            private:
                friend class ObjectStream;
                Enum & operator = (const Enum &);

            private:
                LSPString   sName;

            protected:
                virtual status_t to_string_padded(LSPString *dst, size_t pad);

            public:
                explicit Enum();
                virtual ~Enum();

            public:
                const LSPString *name() const   { return &sName; }
                const char *utf_name() const    { return sName.get_utf8(); }

                virtual bool instanceof(const char *name) const;
        };
    
    } /* namespace java */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_FMT_JAVA_ENUM_H_ */
