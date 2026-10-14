/*
 * Copyright (C) 2020 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2020 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 26 февр. 2020 г.
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

#ifndef LSP_PLUG_IN_I18N_JSONDICTIONARY_H_
#define LSP_PLUG_IN_I18N_JSONDICTIONARY_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/fmt/json/Parser.h>
#include <lsp-plug.in/i18n/IDictionary.h>
#include <lsp-plug.in/lltl/parray.h>
#include <lsp-plug.in/io/IInSequence.h>
#include <lsp-plug.in/io/IInStream.h>

namespace lsp
{
    namespace i18n
    {
        class JsonDictionary: public IDictionary
        {
            private:
                JsonDictionary & operator = (const JsonDictionary &);

            protected:
                typedef struct node_t
                {
                    LSPString               sKey;
                    LSPString               sValue;
                    JsonDictionary         *pChild;
                } node_t;

            protected:
                lltl::parray<node_t>    vNodes;

            protected:
                status_t            add_node(const node_t *node);
                status_t            parse_json(json::Parser *p);
                node_t             *find_node(const LSPString *key);

            public:
                explicit JsonDictionary();
                virtual ~JsonDictionary();

            public:
                using IDictionary::init;
                using IDictionary::get_value;
                using IDictionary::get_child;
                using IDictionary::lookup;

                virtual status_t    init(const char *path);

                virtual status_t    init(const LSPString *path);

                virtual status_t    init(io::IInSequence *is);

                virtual status_t    init(io::IInStream *is);

                virtual status_t    lookup(const LSPString *key, LSPString *value);

                virtual status_t    lookup(const LSPString *key, IDictionary **value);

                virtual status_t    get_value(size_t index, LSPString *key, LSPString *value);

                virtual status_t    get_child(size_t index, LSPString *key, IDictionary **dict);

                virtual size_t      size();
        };
    }

} /* namespace lsp */

#endif /* LSP_PLUG_IN_I18N_JSONDICTIONARY_H_ */
